import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTelegramDistributorContext } from '@/lib/telegram/order-context'
import { getTelegramLinkByTelegramUserId } from '@/lib/telegram/link-service'
import { notifyAfterMessagingInvoice } from '@/lib/messaging/invoice-notify'

export interface PendingReceiptOrder {
  orderId: string
  orderNo: string
  shippedAt: string | null
  deliveryReference: string | null
}

export async function listPendingReceiptOrdersForTelegram(
  telegramUserId: number,
): Promise<PendingReceiptOrder[]> {
  const link = await getTelegramLinkByTelegramUserId(telegramUserId)
  if (!link) return []

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('messaging_warehouse_inbox')
    .select(`
      order_id,
      order_no,
      shipped_at,
      delivery_reference,
      receipt_status,
      status,
      orders!inner (
        id,
        buyer_org_id,
        display_doc_no,
        order_no,
        source_channel
      )
    `)
    .eq('status', 'shipped')
    .or('receipt_status.eq.pending_receipt,receipt_status.is.null')
    .eq('orders.buyer_org_id', link.organization_id)
    .order('shipped_at', { ascending: false })
    .limit(10)

  if (error) throw error

  return (data || [])
    .filter((row: any) => {
      const channel = row.orders?.source_channel
      return channel === 'telegram' || channel === 'whatsapp'
    })
    .map((row: any) => ({
      orderId: row.order_id as string,
      orderNo: row.order_no || row.orders?.display_doc_no || row.orders?.order_no || row.order_id.slice(0, 8),
      shippedAt: row.shipped_at,
      deliveryReference: row.delivery_reference,
    }))
}

export async function resolveReceiptOrderForTelegram(
  telegramUserId: number,
  orderNoArg?: string | null,
): Promise<{ orderId: string; orderNo: string }> {
  const ctx = await resolveTelegramDistributorContext(telegramUserId)
  const admin = createAdminClient()

  const needle = orderNoArg?.trim()
  if (needle) {
    const { data: orders, error } = await admin
      .from('orders')
      .select('id, order_no, display_doc_no, buyer_org_id, source_channel')
      .eq('buyer_org_id', ctx.distributorId)
      .in('source_channel', ['telegram', 'whatsapp'])
      .or(`order_no.ilike.%${needle}%,display_doc_no.ilike.%${needle}%`)
      .limit(5)

    if (error) throw error
    const match = (orders || []).find((o) =>
      o.order_no?.toLowerCase().includes(needle.toLowerCase())
      || o.display_doc_no?.toLowerCase().includes(needle.toLowerCase()),
    ) || orders?.[0]

    if (!match) {
      throw Object.assign(new Error(`Order not found: ${needle}`), { status: 404 })
    }

    return {
      orderId: match.id,
      orderNo: match.display_doc_no || match.order_no || match.id.slice(0, 8),
    }
  }

  const pending = await listPendingReceiptOrdersForTelegram(telegramUserId)
  if (pending.length === 0) {
    throw Object.assign(new Error('No shipped orders awaiting receipt.'), { status: 404 })
  }

  return { orderId: pending[0].orderId, orderNo: pending[0].orderNo }
}

export async function runTelegramAcknowledgeReceipt(
  telegramUserId: number,
  orderNoArg?: string | null,
): Promise<{
  orderNo: string
  invoiceNo: string
  invoiceTotal: number
}> {
  const ctx = await resolveTelegramDistributorContext(telegramUserId)
  const { orderId, orderNo } = await resolveReceiptOrderForTelegram(telegramUserId, orderNoArg)

  const { data, error } = await (ctx.supabase as any).rpc('messaging_acknowledge_receipt', {
    p_order_id: orderId,
    p_user_id: ctx.userId,
    p_channel: 'telegram',
    p_channel_user_id: String(telegramUserId),
  })

  if (error || !data) {
    throw Object.assign(new Error(error?.message || 'Receipt acknowledgement failed.'), { status: 409 })
  }

  await notifyAfterMessagingInvoice(orderId, data)

  return {
    orderNo: data.order_no || orderNo,
    invoiceNo: data.invoice_no,
    invoiceTotal: Number(data.invoice_total || 0),
  }
}

export type DiscrepancyIssueType = 'short_quantity' | 'extra_quantity' | 'wrong_item' | 'damaged_item'

export interface ParsedDiscrepancyLine {
  issue_type: DiscrepancyIssueType
  shipped_quantity: number
  received_quantity: number
}

const ISSUE_ALIASES: Record<string, DiscrepancyIssueType> = {
  short: 'short_quantity',
  short_quantity: 'short_quantity',
  shortage: 'short_quantity',
  extra: 'extra_quantity',
  extra_quantity: 'extra_quantity',
  wrong: 'wrong_item',
  wrong_item: 'wrong_item',
  damaged: 'damaged_item',
  damaged_item: 'damaged_item',
}

/**
 * Split Telegram `/report_difference` args so structured lines are not mistaken for order nos.
 * Examples:
 *   SO123 short:100:95 boxes wet
 *   short:100:95,damaged:50:48 note   (no order → latest pending)
 */
export function splitReportDifferenceArgs(args: string): {
  orderNoArg: string | null
  remarks: string
} {
  const trimmed = args.trim()
  if (!trimmed) return { orderNoArg: null, remarks: '' }

  const space = trimmed.indexOf(' ')
  const first = space === -1 ? trimmed : trimmed.slice(0, space)
  const rest = space === -1 ? '' : trimmed.slice(space + 1).trim()

  if (/^[a-z_]+:\d+:\d+$/i.test(first) || first.includes(',')) {
    return { orderNoArg: null, remarks: trimmed }
  }

  return { orderNoArg: first || null, remarks: rest }
}

/**
 * Parse optional structured lines from Telegram:
 *   short:100:95,damaged:50:48 boxes wet
 * Returns { items, remarks }
 */
export function parseDiscrepancyArgs(raw: string): {
  items: ParsedDiscrepancyLine[]
  remarks: string
} {
  const trimmed = raw.trim()
  if (!trimmed) return { items: [], remarks: '' }

  const tokens = trimmed.split(/[,\s]+/).filter(Boolean)
  const items: ParsedDiscrepancyLine[] = []
  const remarkParts: string[] = []

  for (const token of tokens) {
    const match = token.match(/^([a-z_]+):(\d+):(\d+)$/i)
    if (!match) {
      remarkParts.push(token)
      continue
    }
    const issue = ISSUE_ALIASES[match[1].toLowerCase()]
    if (!issue) {
      remarkParts.push(token)
      continue
    }
    items.push({
      issue_type: issue,
      shipped_quantity: Number(match[2]),
      received_quantity: Number(match[3]),
    })
  }

  return { items, remarks: remarkParts.join(' ').trim() }
}

export async function runTelegramReportDiscrepancy(
  telegramUserId: number,
  remarks: string,
  orderNoArg?: string | null,
): Promise<{ orderNo: string; lineCount: number }> {
  const ctx = await resolveTelegramDistributorContext(telegramUserId)
  const { orderId, orderNo } = await resolveReceiptOrderForTelegram(telegramUserId, orderNoArg)
  const parsed = parseDiscrepancyArgs(remarks)

  if (!parsed.remarks && parsed.items.length === 0) {
    throw Object.assign(
      new Error('Describe the problem, or use short:100:95,damaged:50:48 note'),
      { status: 400 },
    )
  }

  const { data, error } = await (ctx.supabase as any).rpc('messaging_report_discrepancy', {
    p_order_id: orderId,
    p_user_id: ctx.userId,
    p_remarks: parsed.remarks || remarks,
    p_channel: 'telegram',
    p_channel_user_id: String(telegramUserId),
    p_items: parsed.items,
  })

  if (error || !data) {
    throw Object.assign(new Error(error?.message || 'Could not report discrepancy.'), { status: 409 })
  }

  return { orderNo: data.order_no || orderNo, lineCount: Number(data.line_count || parsed.items.length || 0) }
}

export function formatReceiptAckTelegramReply(result: {
  orderNo: string
  invoiceNo: string
  invoiceTotal: number
}): string {
  const total = result.invoiceTotal.toFixed(2)
  return [
    `<b>Receipt confirmed</b>`,
    `Order: <b>${result.orderNo}</b>`,
    `Invoice: <b>${result.invoiceNo}</b>`,
    `Total: <b>RM ${total}</b>`,
    '',
    'This is the first time pricing is shown for this order.',
    'Finance will follow up for payment.',
  ].join('\n')
}

export function formatDiscrepancyReportTelegramReply(orderNo: string, lineCount = 0): string {
  return [
    `<b>Difference reported</b>`,
    `Order: <b>${orderNo}</b>`,
    lineCount > 0 ? `Lines: ${lineCount}` : null,
    '',
    'HQ will review before the invoice is issued.',
  ].filter(Boolean).join('\n')
}

export function formatPendingReceiptsTelegramReply(items: PendingReceiptOrder[]): string {
  if (items.length === 0) {
    return 'No orders awaiting receipt confirmation.'
  }
  const lines = items.map((item, index) => {
    const ref = item.deliveryReference ? ` · ref ${item.deliveryReference}` : ''
    return `${index + 1}. <b>${item.orderNo}</b>${ref}`
  })
  return [
    '<b>Awaiting receipt</b>',
    ...lines,
    '',
    '/received ORDER_NO — received in full',
    '/report_difference ORDER_NO your message — report a problem',
  ].join('\n')
}
