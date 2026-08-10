import { createAdminClient } from '@/lib/supabase/admin'
import { escapeTelegramHtml, sendTelegramMessage } from '@/lib/telegram/bot-api'

/**
 * Best-effort Telegram notify for messaging orders.
 * Never throws to callers — notification failure must not reverse business txs.
 */
export async function notifyMessagingOrderTelegram(input: {
  buyerOrgId: string
  createdByUserId?: string | null
  text: string
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    const admin = createAdminClient()
    let chatId: number | null = null

    if (input.createdByUserId) {
      const { data: byUser } = await admin
        .from('telegram_links')
        .select('telegram_chat_id')
        .eq('user_id', input.createdByUserId)
        .eq('is_active', true)
        .maybeSingle()
      if (byUser?.telegram_chat_id) chatId = Number(byUser.telegram_chat_id)
    }

    if (chatId == null) {
      const { data: byOrg } = await admin
        .from('telegram_links')
        .select('telegram_chat_id')
        .eq('organization_id', input.buyerOrgId)
        .eq('is_active', true)
        .order('linked_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (byOrg?.telegram_chat_id) chatId = Number(byOrg.telegram_chat_id)
    }

    if (chatId == null) {
      return { sent: false, reason: 'no_telegram_link' }
    }

    await sendTelegramMessage({
      chatId,
      text: input.text,
      parseMode: 'HTML',
    })
    return { sent: true }
  } catch (error) {
    console.warn('[messaging/telegram-notify]', error)
    return {
      sent: false,
      reason: error instanceof Error ? error.message : 'telegram_send_failed',
    }
  }
}

export function formatMessagingStatusTelegram(input: {
  orderNo: string
  stage: 'preparing' | 'ready_to_ship' | 'shipped'
  deliveryMethod?: string | null
  deliveryReference?: string | null
}): string {
  const no = escapeTelegramHtml(input.orderNo)
  if (input.stage === 'preparing') {
    return `<b>${no}</b> is now being prepared by the warehouse.`
  }
  if (input.stage === 'ready_to_ship') {
    return `<b>${no}</b> is ready for shipment.\nStock has been reserved for your order.`
  }
  if (input.stage === 'shipped') {
    const method = escapeTelegramHtml(input.deliveryMethod || 'other')
    const ref = input.deliveryReference
      ? `\nDelivery reference: <code>${escapeTelegramHtml(input.deliveryReference)}</code>`
      : ''
    return [
      `<b>${no}</b> has been shipped.`,
      `Delivery: ${method}${ref}`,
      '',
      'When goods arrive:',
      '/received — confirm full receipt',
      '/report_difference — report a problem',
    ].join('\n')
  }
  return `<b>${no}</b> status updated.`
}
