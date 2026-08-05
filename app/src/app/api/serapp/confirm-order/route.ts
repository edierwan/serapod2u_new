import { NextResponse } from 'next/server'
import { matchPastedOrder } from '@/components/orders/quick-order-matcher'
import { validateQuickOrderCatalogItems } from '@/lib/orders/quick-order-catalog'
import { createAdminClient } from '@/lib/supabase/admin'
import { summarizeSerappPasteCheck } from '@/lib/serapp/paste-check-summary'
import { registerSerappOrderHold } from '@/lib/serapp/hold-service'
import {
  buildSerappConfirmItems,
  buildSerappOrderNotes,
  loadSerappCatalog,
  resolveSerappDistributorContext,
} from '@/lib/serapp/order-context'

/**
 * Serapp Confirm Order
 *
 * 1) Re-parse + re-check stock
 * 2) Create D2H order via current `submit_and_allocate_d2h_order` (allocate on submit)
 * 3) Register a 1-hour Serapp hold window for warehouse acceptance
 *
 * Non-Serapp Dashboard orders are untouched.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const pasteText = typeof body?.pasteText === 'string' ? body.pasteText : ''
    if (!pasteText.trim()) {
      return NextResponse.json({ error: 'Paste text is required to confirm the order.' }, { status: 400 })
    }

    const acceptAvailableOnly = body?.acceptAvailableOnly !== false
    const idempotencyKey = typeof body?.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim().slice(0, 120)
      : null

    const ctx = await resolveSerappDistributorContext({
      distributorId: typeof body?.distributorId === 'string' ? body.distributorId : null,
      fulfillmentWarehouseId: typeof body?.fulfillmentWarehouseId === 'string'
        ? body.fulfillmentWarehouseId
        : null,
    })

    const catalog = await loadSerappCatalog(ctx)
    const results = matchPastedOrder(pasteText, catalog.variants)
    const summary = summarizeSerappPasteCheck(results)

    if (summary.bucket === 'unmatched_or_review' || summary.bucket === 'out_of_stock') {
      return NextResponse.json({
        error: `Cannot confirm while status is "${summary.label}". Resolve the list and Check again.`,
        summary,
        results,
      }, { status: 409 })
    }

    const { items, skipped } = buildSerappConfirmItems(results, catalog.variants, { acceptAvailableOnly })
    if (items.length === 0) {
      return NextResponse.json({
        error: 'No confirmable lines remain after stock re-check.',
        summary,
        results,
      }, { status: 409 })
    }

    try {
      validateQuickOrderCatalogItems(
        items.map(item => ({ variantId: item.variant_id, quantity: item.qty })),
        catalog.variants,
        catalog.fulfillmentWarehouseName,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stock or price validation failed.'
      return NextResponse.json({ error: message, summary, results }, { status: 409 })
    }

    const { data: companyId, error: companyError } = await ctx.supabase
      .rpc('get_company_id', { p_org_id: ctx.hqId })

    if (companyError || !companyId) {
      console.error('[serapp/confirm-order] company lookup failed', companyError)
      return NextResponse.json({ error: 'Unable to resolve company for this order.' }, { status: 500 })
    }

    const notes = buildSerappOrderNotes({
      pasteText,
      distributorName: ctx.distributorName,
      warehouseName: catalog.fulfillmentWarehouseName,
    })

    const estimatedOrderValue = items.reduce((sum, item) => sum + item.qty * item.unit_price, 0)

    const { data: order, error: submitError } = await (ctx.supabase as any).rpc(
      'submit_and_allocate_d2h_order',
      {
        p_company_id: companyId,
        p_buyer_org_id: ctx.distributorId,
        p_seller_org_id: ctx.hqId,
        p_fulfillment_warehouse_id: ctx.fulfillmentWarehouseId,
        p_items: items.map(item => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          qty: item.qty,
          unit_price: item.unit_price,
        })),
        p_notes: notes,
        p_created_by: ctx.userId,
        p_idempotency_key: idempotencyKey,
      },
    )

    if (submitError || !order) {
      console.error('[serapp/confirm-order] submit failed', submitError)
      return NextResponse.json({
        error: submitError?.message || 'Failed to submit and allocate the order.',
      }, { status: 409 })
    }

    const admin = createAdminClient()
    let hold = null
    try {
      hold = await registerSerappOrderHold(admin, {
        orderId: order.id,
        buyerOrgId: ctx.distributorId,
        sellerHqId: ctx.hqId,
        fulfillmentWarehouseId: ctx.fulfillmentWarehouseId,
        createdBy: ctx.userId,
        orderNo: order.display_doc_no || order.order_no,
        warehouseName: catalog.fulfillmentWarehouseName,
      })
    } catch (holdError) {
      console.error('[serapp/confirm-order] hold registration failed — rolling back allocation', holdError)

      const { error: cancelError } = await admin
        .from('orders')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
          notes: `${notes}\n\nCancelled: Serapp hold registration failed after allocate.`,
        })
        .eq('id', order.id)
        .eq('status', 'submitted')

      if (cancelError) {
        console.error('[serapp/confirm-order] rollback cancel failed', cancelError)
      }

      const { error: releaseError } = await admin.rpc('release_allocation_for_order', {
        p_order_id: order.id,
      })
      if (releaseError) {
        console.warn('[serapp/confirm-order] rollback release:', releaseError.message)
      }

      return NextResponse.json({
        ok: false,
        error: 'Order allocation was rolled back because the 1-hour Serapp hold could not be saved. Please try Confirm again.',
        order: {
          id: order.id,
          order_no: order.order_no,
          display_doc_no: order.display_doc_no,
          status: 'cancelled',
        },
        hold: null,
        confirmedLines: 0,
        skippedLines: items.length + skipped,
        estimatedOrderValue: 0,
        summary,
      }, { status: 500 })
    }

    await fetch(new URL('/api/notifications/order-event', request.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify({ orderId: order.id, eventCode: 'order_submitted' }),
    }).catch((error) => {
      console.warn('[serapp/confirm-order] notification queue failed', error)
    })

    return NextResponse.json({
      ok: true,
      source: 'Serapp Conversation',
      allocation: 'current_flow_on_submit_with_1h_acceptance_window',
      note: 'Order created via Current Order Module and allocated on submit. Warehouse must accept within 1 hour or the Serapp hold expires and stock is released.',
      order: {
        id: order.id,
        order_no: order.order_no,
        display_doc_no: order.display_doc_no,
        status: order.status,
      },
      hold: {
        id: hold.id,
        status: hold.status,
        expires_at: hold.expires_at,
        reserved_at: hold.reserved_at,
      },
      confirmedLines: items.length,
      skippedLines: skipped,
      summary,
      fulfillmentWarehouse: {
        id: catalog.inventoryOrganizationId,
        name: catalog.fulfillmentWarehouseName,
      },
      estimatedOrderValue,
    })
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number'
      ? (error as { status: number }).status
      : 500
    const message = error instanceof Error ? error.message : 'Confirm order failed.'
    console.error('[serapp/confirm-order]', error)
    return NextResponse.json({ error: message }, { status })
  }
}

export const dynamic = 'force-dynamic'
