import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTelegramDistributorContext } from '@/lib/telegram/order-context'
import { getTelegramLinkByTelegramUserId } from '@/lib/telegram/link-service'

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

  return {
    orderNo: data.order_no || orderNo,
    invoiceNo: data.invoice_no,
    invoiceTotal: Number(data.invoice_total || 0),
  }
}

export async function runTelegramReportDiscrepancy(
  telegramUserId: number,
  remarks: string,
  orderNoArg?: string | null,
): Promise<{ orderNo: string }> {
  const ctx = await resolveTelegramDistributorContext(telegramUserId)
  const { orderId, orderNo } = await resolveReceiptOrderForTelegram(telegramUserId, orderNoArg)

  const { data, error } = await (ctx.supabase as any).rpc('messaging_report_discrepancy', {
    p_order_id: orderId,
    p_user_id: ctx.userId,
    p_remarks: remarks,
    p_channel: 'telegram',
    p_channel_user_id: String(telegramUserId),
  })

  if (error || !data) {
    throw Object.assign(new Error(error?.message || 'Could not report discrepancy.'), { status: 409 })
  }

  return { orderNo: data.order_no || orderNo }
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

export function formatDiscrepancyReportTelegramReply(orderNo: string): string {
  return [
    `<b>Difference reported</b>`,
    `Order: <b>${orderNo}</b>`,
    '',
    'HQ will review before the invoice is issued.',
  ].join('\n')
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
