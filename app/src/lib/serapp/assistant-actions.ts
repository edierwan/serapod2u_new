import { validateQuickOrderCatalogItems } from '@/lib/orders/quick-order-catalog'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getSerappAccessDecision } from '@/lib/serapp/access'
import { parseSerappLineResolutions, parseSerappQuantityResolutions, runSerappPasteCheck } from '@/lib/serapp/line-resolutions'
import { cancelSerappOrderHoldByDistributor, registerSerappOrderHold } from '@/lib/serapp/hold-service'
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
  quantityResolutions?: unknown
}): Promise<SerappChatCheckPayload> {
  const ctx = await resolveSerappDistributorContext({
    distributorId: input.distributorId || null,
  })
  const catalog = await loadSerappCatalog(ctx)
  const resolutions = parseSerappLineResolutions(input.lineResolutions)
  const quantityResolutions = parseSerappQuantityResolutions(input.quantityResolutions)
  const checked = runSerappPasteCheck(input.pasteText, catalog.variants, resolutions, quantityResolutions)

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
  quantityResolutions?: unknown
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
  const quantityResolutions = parseSerappQuantityResolutions(input.quantityResolutions)
  const checked = runSerappPasteCheck(pasteText, catalog.variants, resolutions, quantityResolutions)
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

export type SerappCancelHoldResult = {
  ok: true
  hold: { id: string; order_id: string }
  note: string
} | {
  ok: false
  error: string
  status: number
}

/**
 * Cancel Serapp hold in-process (no HTTP self-fetch).
 * Same contract as /api/serapp/cancel-hold.
 */
export async function runSerappCancelHold(input: {
  orderId: string
}): Promise<SerappCancelHoldResult> {
  const orderId = input.orderId.trim()
  if (!orderId) {
    return { ok: false, error: 'orderId is required.', status: 400 }
  }

  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'Unauthorized', status: 401 }
  }

  const { data: requester, error: requesterError } = await supabase
    .from('users')
    .select(`
      id,
      organization_id,
      account_scope,
      organizations:organization_id ( id, org_type_code )
    `)
    .eq('id', user.id)
    .single()

  if (requesterError || !requester?.organization_id) {
    return { ok: false, error: 'User organization not found.', status: 403 }
  }

  const organization = Array.isArray(requester.organizations)
    ? requester.organizations[0]
    : requester.organizations

  const access = getSerappAccessDecision({
    accountScope: requester.account_scope,
    orgTypeCode: organization?.org_type_code,
    organizationId: requester.organization_id,
    roleLevel: null,
  })

  if (!access.isDistributor && !access.isHqSupport) {
    return { ok: false, error: 'Not allowed to cancel Serapp holds.', status: 403 }
  }

  const admin = createAdminClient()
  const { data: hold, error: holdError } = await admin
    .from('serapp_order_holds')
    .select('id, order_id, buyer_org_id, status')
    .eq('order_id', orderId)
    .maybeSingle()

  if (holdError) {
    console.error('[serapp/cancel-hold] hold lookup failed', holdError)
    return { ok: false, error: holdError.message || 'Cancel failed.', status: 500 }
  }
  if (!hold) {
    return { ok: false, error: 'Serapp hold not found.', status: 404 }
  }

  if (access.isDistributor && hold.buyer_org_id !== requester.organization_id) {
    return { ok: false, error: 'You can only cancel your own Serapp orders.', status: 403 }
  }

  try {
    const cancelled = await cancelSerappOrderHoldByDistributor(admin, {
      orderId,
      cancelledBy: user.id,
    })

    return {
      ok: true,
      hold: cancelled,
      note: 'Serapp hold cancelled and stock released.',
    }
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number'
      ? (error as { status: number }).status
      : 500
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Cancel failed.',
      status,
    }
  }
}
