import { randomUUID } from 'crypto'
import { matchPastedOrder } from '@/components/orders/quick-order-matcher'
import { validateQuickOrderCatalogItems } from '@/lib/orders/quick-order-catalog'
import { summarizeSerappPasteCheck } from '@/lib/serapp/paste-check-summary'
import {
  buildSerappConfirmItems,
  buildSerappOrderNotes,
  loadSerappCatalog,
} from '@/lib/serapp/order-context'
import { resolveTelegramDistributorContext } from '@/lib/telegram/order-context'
import { TELEGRAM_ORDER_SOURCE_CHANNEL } from '@/lib/telegram/source-channel'
import {
  notifyMessagingOrderConfirmed,
} from '@/lib/messaging/notifications'
import type { SerappPasteCheckSummary } from '@/lib/serapp/paste-check-summary'

export interface TelegramPasteCheckResult {
  summary: SerappPasteCheckSummary
  distributorName: string
  warehouseName: string
  /** Kept for internal snapshot / future invoice use — never shown in Telegram replies. */
  estimatedOrderValue: number
  lineCount: number
  totalQuantity: number
}

export interface TelegramConfirmResult {
  orderNo: string | null
  orderId: string
  confirmedLines: number
  skippedLines: number
  estimatedOrderValue: number
  summary: SerappPasteCheckSummary
  warehouseName: string
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

  const totalQuantity = results.reduce((sum, result) => {
    if (result.status === 'section_header') return sum
    if (!result.quantity || result.quantity <= 0) return sum
    return sum + result.quantity
  }, 0)

  return {
    summary,
    distributorName: ctx.distributorName,
    warehouseName: catalog.fulfillmentWarehouseName,
    estimatedOrderValue,
    lineCount: summary.totalLines,
    totalQuantity,
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
      new Error(`Cannot submit while status is "${summary.label}". Fix the list and Check again.`),
      { status: 409, summary },
    )
  }

  const { items, skipped } = buildSerappConfirmItems(results, catalog.variants, { acceptAvailableOnly: true })
  if (items.length === 0) {
    throw Object.assign(new Error('No submittable lines remain after stock re-check.'), { status: 409, summary })
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
    channelLabel: 'Telegram',
  })

  const estimatedOrderValue = items.reduce((sum, item) => sum + item.qty * item.unit_price, 0)
  const key = idempotencyKey?.trim().slice(0, 120) || `tg-${telegramUserId}-${randomUUID()}`

  // Messaging path: submit SO without allocating. Classic Serapp keeps submit_and_allocate.
  const { data: order, error: submitError } = await (ctx.supabase as any).rpc(
    'submit_d2h_order',
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
      p_source_channel: TELEGRAM_ORDER_SOURCE_CHANNEL,
    },
  )

  if (submitError || !order) {
    throw Object.assign(
      new Error(submitError?.message || 'Failed to submit the order.'),
      { status: 409 },
    )
  }

  const totalQuantity = items.reduce((sum, item) => sum + item.qty, 0)
  await notifyMessagingOrderConfirmed({
    hqOrgId: ctx.hqId,
    buyerOrgId: ctx.distributorId,
    createdByUserId: ctx.userId,
    orderId: order.id,
    orderNo: order.display_doc_no || order.order_no || order.id.slice(0, 8),
    distributorName: ctx.distributorName,
    lineCount: items.length,
    totalQuantity,
  })

  return {
    orderNo: order.display_doc_no || order.order_no || null,
    orderId: order.id,
    confirmedLines: items.length,
    skippedLines: skipped,
    estimatedOrderValue,
    summary,
    warehouseName: catalog.fulfillmentWarehouseName,
  }
}

/**
 * Distributor-facing Telegram copy only.
 * Prices stay hidden. Confirm reserves stock and notifies warehouse (spec §7–§12).
 */
export function formatTelegramCheckReply(result: TelegramPasteCheckResult): string {
  const lines = [
    `<b>Order summary</b>`,
    `Status: <b>${result.summary.label}</b>`,
    `Lines: ${result.lineCount} · Total qty: ${result.totalQuantity}`,
    `Warehouse: ${result.warehouseName}`,
    '',
    'Reply /submit (or /confirm) to confirm this order.',
    'Stock is checked now; it will be reserved when you confirm.',
    '/cancel clears this draft.',
  ]
  return lines.join('\n')
}

export function formatTelegramConfirmReply(result: TelegramConfirmResult): string {
  return [
    `<b>Order confirmed</b>`,
    `No: <b>${result.orderNo || result.orderId.slice(0, 8)}</b>`,
    `Lines: ${result.confirmedLines}`,
    `Warehouse: ${result.warehouseName}`,
    '',
    'Your warehouse has been notified.',
    'Stock has been reserved for your order.',
    'You will be notified when preparation starts.',
  ].join('\n')
}
