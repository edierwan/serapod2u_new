import { randomUUID } from 'crypto'
import { matchPastedOrder } from '@/components/orders/quick-order-matcher'
import { validateQuickOrderCatalogItems } from '@/lib/orders/quick-order-catalog'
import { createAdminClient } from '@/lib/supabase/admin'
import { registerSerappOrderHold } from '@/lib/serapp/hold-service'
import { summarizeSerappPasteCheck } from '@/lib/serapp/paste-check-summary'
import {
  buildSerappConfirmItems,
  buildSerappOrderNotes,
  loadSerappCatalog,
} from '@/lib/serapp/order-context'
import { resolveTelegramDistributorContext } from '@/lib/telegram/order-context'
import type { SerappPasteCheckSummary } from '@/lib/serapp/paste-check-summary'

export interface TelegramPasteCheckResult {
  summary: SerappPasteCheckSummary
  distributorName: string
  warehouseName: string
  estimatedOrderValue: number
  lineCount: number
}

export interface TelegramConfirmResult {
  orderNo: string | null
  orderId: string
  holdExpiresAt: string
  confirmedLines: number
  skippedLines: number
  estimatedOrderValue: number
  summary: SerappPasteCheckSummary
}

export async function runTelegramPasteCheck(
  telegramUserId: number,
  pasteText: string,
): Promise<TelegramPasteCheckResult> {
  const ctx = await resolveTelegramDistributorContext(telegramUserId)
  const catalog = await loadSerappCatalog(ctx)
  const results = matchPastedOrder(pasteText, catalog.variants)
  const summary = summarizeSerappPasteCheck(results)

  const estimatedOrderValue = results.reduce((sum, result) => {
    if (!result.selectedVariantId || !result.quantity || result.quantity <= 0) return sum
    if (result.status !== 'matched' && result.status !== 'alternative_match') return sum
    if (result.inventoryOutcome && result.inventoryOutcome !== 'matched') return sum
    const variant = catalog.variants.find(item => item.id === result.selectedVariantId)
    return sum + (result.quantity * (variant?.distributor_price || 0))
  }, 0)

  return {
    summary,
    distributorName: ctx.distributorName,
    warehouseName: catalog.fulfillmentWarehouseName,
    estimatedOrderValue,
    lineCount: summary.totalLines,
  }
}

export async function runTelegramConfirmOrder(
  telegramUserId: number,
  pasteText: string,
  idempotencyKey?: string | null,
): Promise<TelegramConfirmResult> {
  const ctx = await resolveTelegramDistributorContext(telegramUserId)
  const catalog = await loadSerappCatalog(ctx)
  const results = matchPastedOrder(pasteText, catalog.variants)
  const summary = summarizeSerappPasteCheck(results)

  if (summary.bucket === 'unmatched_or_review' || summary.bucket === 'out_of_stock') {
    throw Object.assign(
      new Error(`Cannot confirm while status is "${summary.label}". Fix the list and Check again.`),
      { status: 409, summary },
    )
  }

  const { items, skipped } = buildSerappConfirmItems(results, catalog.variants, { acceptAvailableOnly: true })
  if (items.length === 0) {
    throw Object.assign(new Error('No confirmable lines remain after stock re-check.'), { status: 409, summary })
  }

  validateQuickOrderCatalogItems(
    items.map(item => ({ variantId: item.variant_id, quantity: item.qty })),
    catalog.variants,
    catalog.fulfillmentWarehouseName,
  )

  const { data: companyId, error: companyError } = await ctx.supabase
    .rpc('get_company_id', { p_org_id: ctx.hqId })

  if (companyError || !companyId) {
    throw Object.assign(new Error('Unable to resolve company for this order.'), { status: 500 })
  }

  const notes = buildSerappOrderNotes({
    pasteText,
    distributorName: ctx.distributorName,
    warehouseName: catalog.fulfillmentWarehouseName,
  })

  const estimatedOrderValue = items.reduce((sum, item) => sum + item.qty * item.unit_price, 0)
  const key = idempotencyKey?.trim().slice(0, 120) || `tg-${telegramUserId}-${randomUUID()}`

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
      p_idempotency_key: key,
    },
  )

  if (submitError || !order) {
    throw Object.assign(
      new Error(submitError?.message || 'Failed to submit and allocate the order.'),
      { status: 409 },
    )
  }

  const admin = createAdminClient()
  let hold
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
    console.error('[telegram/confirm] hold registration failed — rolling back', holdError)

    await admin
      .from('orders')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
        notes: `${notes}\n\nCancelled: Serapp hold registration failed after allocate.`,
      })
      .eq('id', order.id)
      .eq('status', 'submitted')

    await admin.rpc('release_allocation_for_order', { p_order_id: order.id })

    throw Object.assign(
      new Error('Order was rolled back because the 1-hour hold could not be saved. Try /confirm again.'),
      { status: 500 },
    )
  }

  return {
    orderNo: order.display_doc_no || order.order_no || null,
    orderId: order.id,
    holdExpiresAt: hold.expires_at,
    confirmedLines: items.length,
    skippedLines: skipped,
    estimatedOrderValue,
    summary,
  }
}

export function formatTelegramCheckReply(result: TelegramPasteCheckResult): string {
  const value = result.estimatedOrderValue.toFixed(2)
  const lines = [
    `<b>Paste &amp; Check</b>`,
    `Status: <b>${result.summary.label}</b>`,
    `Lines: ${result.lineCount} · Est. RM ${value}`,
    `Warehouse: ${result.warehouseName}`,
    '',
    'Reply /confirm to submit (1h warehouse acceptance window).',
    '/cancel clears this draft.',
  ]
  return lines.join('\n')
}

export function formatTelegramConfirmReply(result: TelegramConfirmResult): string {
  const expires = new Date(result.holdExpiresAt).toLocaleString('en-MY', { hour12: true })
  return [
    `<b>Order confirmed</b>`,
    `No: <b>${result.orderNo || result.orderId.slice(0, 8)}</b>`,
    `Lines: ${result.confirmedLines} · Est. RM ${result.estimatedOrderValue.toFixed(2)}`,
    `Hold expires: ${expires}`,
    '',
    'Warehouse must accept within 1 hour or stock is released.',
  ].join('\n')
}
