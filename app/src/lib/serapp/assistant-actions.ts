import { validateQuickOrderCatalogItems } from '@/lib/orders/quick-order-catalog'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseSerappLineResolutions, runSerappPasteCheck } from '@/lib/serapp/line-resolutions'
import { registerSerappOrderHold } from '@/lib/serapp/hold-service'
import {
  buildSerappConfirmItems,
  buildSerappOrderNotes,
  loadSerappCatalog,
  resolveSerappDistributorContext,
} from '@/lib/serapp/order-context'
import type { SerappChatCheckPayload } from '@/lib/serapp/chat-types'

export async function runSerappStockCheck(input: {
  pasteText: string
  distributorId?: string | null
  lineResolutions?: unknown
}): Promise<SerappChatCheckPayload> {
  const ctx = await resolveSerappDistributorContext({
    distributorId: input.distributorId || null,
  })
  const catalog = await loadSerappCatalog(ctx)
  const resolutions = parseSerappLineResolutions(input.lineResolutions)
  const checked = runSerappPasteCheck(input.pasteText, catalog.variants, resolutions)

  return {
    summary: checked.summary,
    results: checked.results,
    estimatedOrderValue: checked.estimatedOrderValue,
    warehouseName: catalog.fulfillmentWarehouseName,
    distributorName: ctx.distributorName,
    pasteText: input.pasteText,
  }
}

export type SerappConfirmOrderResult = {
  ok: true
  order: {
    id: string
    order_no: string
    display_doc_no?: string | null
    status: string
  }
  hold: {
    id: string
    status: string
    expires_at: string
    reserved_at: string
  } | null
  confirmedLines: number
  skippedLines: number
  estimatedOrderValue: number
  fulfillmentWarehouse?: { id: string; name: string | null }
  note?: string
  summary: SerappChatCheckPayload['summary']
} | {
  ok: false
  error: string
  status: number
  summary?: SerappChatCheckPayload['summary']
  results?: SerappChatCheckPayload['results']
  order?: {
    id: string
    order_no: string
    display_doc_no?: string | null
    status: string
  }
  hold?: null
  confirmedLines?: number
  skippedLines?: number
  estimatedOrderValue?: number
}

/**
 * Confirm Serapp order in-process (no HTTP self-fetch).
 * Same contract as /api/serapp/confirm-order.
 */
export async function runSerappConfirmOrder(input: {
  pasteText: string
  distributorId?: string | null
  fulfillmentWarehouseId?: string | null
  acceptAvailableOnly?: boolean
  idempotencyKey?: string | null
  lineResolutions?: unknown
  /** Optional cookie/request URL for best-effort notification fan-out. */
  request?: Request | null
}): Promise<SerappConfirmOrderResult> {
  const pasteText = input.pasteText
  if (!pasteText.trim()) {
    return { ok: false, error: 'Paste text is required to confirm the order.', status: 400 }
  }

  const acceptAvailableOnly = input.acceptAvailableOnly !== false
  const idempotencyKey = typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
    ? input.idempotencyKey.trim().slice(0, 120)
    : null

  const ctx = await resolveSerappDistributorContext({
    distributorId: input.distributorId || null,
    fulfillmentWarehouseId: input.fulfillmentWarehouseId || null,
  })

  const catalog = await loadSerappCatalog(ctx)
  const resolutions = parseSerappLineResolutions(input.lineResolutions)
  const checked = runSerappPasteCheck(pasteText, catalog.variants, resolutions)
  const { results, summary } = checked

  if (summary.bucket === 'unmatched_or_review' || summary.bucket === 'out_of_stock') {
    return {
      ok: false,
      error: `Cannot confirm while status is "${summary.label}". Resolve the list and Check again.`,
      status: 409,
      summary,
      results,
    }
  }

  const { items, skipped } = buildSerappConfirmItems(results, catalog.variants, { acceptAvailableOnly })
  if (items.length === 0) {
    return {
      ok: false,
      error: 'No confirmable lines remain after stock re-check.',
      status: 409,
      summary,
      results,
    }
  }

  try {
    validateQuickOrderCatalogItems(
      items.map(item => ({ variantId: item.variant_id, quantity: item.qty })),
      catalog.variants,
      catalog.fulfillmentWarehouseName,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stock or price validation failed.'
    return { ok: false, error: message, status: 409, summary, results }
  }

  const { data: companyId, error: companyError } = await ctx.supabase
    .rpc('get_company_id', { p_org_id: ctx.hqId })

  if (companyError || !companyId) {
    console.error('[serapp/confirm-order] company lookup failed', companyError)
    return { ok: false, error: 'Unable to resolve company for this order.', status: 500 }
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
    return {
      ok: false,
      error: submitError?.message || 'Failed to submit and allocate the order.',
      status: 409,
    }
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

    return {
      ok: false,
      error: 'Order allocation was rolled back because the 1-hour Serapp hold could not be saved. Please try Confirm again.',
      status: 500,
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
    }
  }

  if (input.request) {
    await fetch(new URL('/api/notifications/order-event', input.request.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: input.request.headers.get('cookie') || '',
      },
      body: JSON.stringify({ orderId: order.id, eventCode: 'order_submitted' }),
    }).catch((error) => {
      console.warn('[serapp/confirm-order] notification queue failed', error)
    })
  }

  return {
    ok: true,
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
    estimatedOrderValue,
    summary,
    fulfillmentWarehouse: {
      id: catalog.inventoryOrganizationId,
      name: catalog.fulfillmentWarehouseName,
    },
    note: 'Order created via Current Order Module and allocated on submit. Warehouse must accept within 1 hour or the Serapp hold expires and stock is released.',
  }
}
