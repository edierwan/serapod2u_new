import { resolveTelegramDistributorContext } from '@/lib/telegram/order-context'
import { createAdminClient } from '@/lib/supabase/admin'

export async function runTelegramAcceptPartial(
  telegramUserId: number,
  orderNoArg?: string | null,
): Promise<{ orderNo: string; shortLines: number }> {
  const ctx = await resolveTelegramDistributorContext(telegramUserId)
  const admin = createAdminClient()

  let orderId: string | null = null
  let orderNo = orderNoArg?.trim() || ''

  if (orderNoArg?.trim()) {
    const needle = orderNoArg.trim()
    const { data: orders } = await admin
      .from('orders')
      .select('id, order_no, display_doc_no')
      .eq('buyer_org_id', ctx.distributorId)
      .in('source_channel', ['telegram', 'whatsapp'])
      .or(`order_no.ilike.%${needle}%,display_doc_no.ilike.%${needle}%`)
      .limit(5)
    const match = orders?.[0]
    if (!match) {
      throw Object.assign(new Error(`Order not found: ${needle}`), { status: 404 })
    }
    orderId = match.id
    orderNo = match.display_doc_no || match.order_no || match.id.slice(0, 8)
  } else {
    const { data: inbox } = await admin
      .from('messaging_warehouse_inbox')
      .select('order_id, order_no, status')
      .eq('buyer_org_id', ctx.distributorId)
      .eq('status', 'awaiting_partial_confirmation')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!inbox) {
      throw Object.assign(new Error('No order is waiting for partial acceptance.'), { status: 404 })
    }
    orderId = inbox.order_id
    orderNo = inbox.order_no || orderId.slice(0, 8)
  }

  const { data, error } = await (ctx.supabase as any).rpc('messaging_accept_partial', {
    p_order_id: orderId,
    p_user_id: ctx.userId,
    p_channel: 'telegram',
    p_channel_user_id: String(telegramUserId),
  })

  if (error || !data) {
    throw Object.assign(new Error(error?.message || 'Could not accept partial quantity.'), { status: 409 })
  }

  return {
    orderNo: data.order_no || orderNo,
    shortLines: Number(data.short_lines || 0),
  }
}
