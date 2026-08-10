import { createAdminClient } from '@/lib/supabase/admin'
import { escapeTelegramHtml, sendTelegramMessage } from '@/lib/telegram/bot-api'
import { buildMessagingOrderDeepLink } from '@/lib/messaging/deep-links'
import { logMessageNotification } from '@/lib/messaging/notification-log'
import {
  notifyMessagingOrderTelegram,
  formatMessagingStatusTelegram,
} from '@/lib/messaging/telegram-notify'

export interface MessagingChannelSettingsRow {
  messaging_orders_enabled: boolean
  telegram_ordering_enabled: boolean
  telegram_notifications_enabled: boolean
  whatsapp_ordering_enabled: boolean
  warehouse_telegram_chat_id: string | null
  finance_telegram_chat_id: string | null
}

async function loadMessagingSettings(hqOrgId: string): Promise<MessagingChannelSettingsRow | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('messaging_channel_settings')
    .select(
      'messaging_orders_enabled, telegram_ordering_enabled, telegram_notifications_enabled, whatsapp_ordering_enabled, warehouse_telegram_chat_id, finance_telegram_chat_id',
    )
    .eq('hq_organization_id', hqOrgId)
    .maybeSingle()
  return data as MessagingChannelSettingsRow | null
}

function envWarehouseChatId(): number | null {
  const raw = process.env.TELEGRAM_WAREHOUSE_CHAT_ID?.trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function envFinanceChatId(): number | null {
  const raw = process.env.TELEGRAM_FINANCE_CHAT_ID?.trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

async function sendTelegramToChat(input: {
  chatId: number
  text: string
  orderId?: string | null
  organizationId?: string | null
  userId?: string | null
  messageType: string
  referenceType?: string
  referenceId?: string | null
}): Promise<{ sent: boolean; reason?: string }> {
  const deepLink = input.orderId ? buildMessagingOrderDeepLink(input.orderId) : null
  const text = deepLink
    ? `${input.text}\n\n<a href="${escapeTelegramHtml(deepLink)}">View Order</a>`
    : input.text

  try {
    await sendTelegramMessage({
      chatId: input.chatId,
      text,
      parseMode: 'HTML',
      replyMarkup: deepLink
        ? { inline_keyboard: [[{ text: 'View Order', url: deepLink }]] }
        : undefined,
    })
    await logMessageNotification({
      organizationId: input.organizationId,
      userId: input.userId,
      channel: 'telegram',
      messageType: input.messageType,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      recipientIdentifier: String(input.chatId),
      status: 'sent',
    })
    return { sent: true }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'telegram_send_failed'
    await logMessageNotification({
      organizationId: input.organizationId,
      userId: input.userId,
      channel: 'telegram',
      messageType: input.messageType,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      recipientIdentifier: String(input.chatId),
      status: 'failed',
      errorMessage: reason,
    })
    return { sent: false, reason }
  }
}

/** §15 — warehouse new order notification after confirm. */
export async function notifyWarehouseNewMessagingOrder(input: {
  hqOrgId: string
  orderId: string
  orderNo: string
  distributorName: string
  lineCount: number
  totalQuantity: number
}): Promise<{ sent: boolean; reason?: string }> {
  const settings = await loadMessagingSettings(input.hqOrgId)
  if (settings && !settings.telegram_notifications_enabled) {
    return { sent: false, reason: 'telegram_notifications_disabled' }
  }

  const chatId =
    (settings?.warehouse_telegram_chat_id ? Number(settings.warehouse_telegram_chat_id) : null)
    ?? envWarehouseChatId()

  if (chatId == null || !Number.isFinite(chatId)) {
    return { sent: false, reason: 'no_warehouse_chat' }
  }

  const text = [
    '<b>New Distributor Order</b>',
    `Order: <b>${escapeTelegramHtml(input.orderNo)}</b>`,
    `Distributor: ${escapeTelegramHtml(input.distributorName)}`,
    `${input.lineCount} items · ${input.totalQuantity} pcs`,
    '',
    'Open Serapod2U warehouse inbox to Start Preparing.',
  ].join('\n')

  return sendTelegramToChat({
    chatId,
    text,
    orderId: input.orderId,
    organizationId: input.hqOrgId,
    messageType: 'warehouse_new_order',
    referenceType: 'order',
    referenceId: input.orderId,
  })
}

/** §40 — finance invoice generated notification. */
export async function notifyFinanceMessagingInvoice(input: {
  hqOrgId: string
  orderId: string
  orderNo: string
  invoiceNo: string
  invoiceTotal: number
}): Promise<{ sent: boolean; reason?: string }> {
  const settings = await loadMessagingSettings(input.hqOrgId)
  if (settings && !settings.telegram_notifications_enabled) {
    return { sent: false, reason: 'telegram_notifications_disabled' }
  }

  const chatId =
    (settings?.finance_telegram_chat_id ? Number(settings.finance_telegram_chat_id) : null)
    ?? envFinanceChatId()

  if (chatId == null || !Number.isFinite(chatId)) {
    return { sent: false, reason: 'no_finance_chat' }
  }

  const text = [
    '<b>Invoice generated</b>',
    `Order: <b>${escapeTelegramHtml(input.orderNo)}</b>`,
    `Invoice: <b>${escapeTelegramHtml(input.invoiceNo)}</b>`,
    `Amount: <b>RM ${input.invoiceTotal.toFixed(2)}</b>`,
  ].join('\n')

  return sendTelegramToChat({
    chatId,
    text,
    orderId: input.orderId,
    organizationId: input.hqOrgId,
    messageType: 'finance_invoice_generated',
    referenceType: 'order',
    referenceId: input.orderId,
  })
}

/** Post-confirm bundle: distributor confirmation + warehouse alert (§12, §15). */
export async function notifyMessagingOrderConfirmed(input: {
  hqOrgId: string
  buyerOrgId: string
  createdByUserId: string
  orderId: string
  orderNo: string
  distributorName: string
  lineCount: number
  totalQuantity: number
}): Promise<void> {
  const orderNo = escapeTelegramHtml(input.orderNo)
  await notifyMessagingOrderTelegram({
    buyerOrgId: input.buyerOrgId,
    createdByUserId: input.createdByUserId,
    orderId: input.orderId,
    text: [
      `<b>Order ${orderNo} confirmed.</b>`,
      'Your warehouse has been notified.',
      'Stock has been reserved for your order.',
    ].join('\n'),
  })

  await notifyWarehouseNewMessagingOrder({
    hqOrgId: input.hqOrgId,
    orderId: input.orderId,
    orderNo: input.orderNo,
    distributorName: input.distributorName,
    lineCount: input.lineCount,
    totalQuantity: input.totalQuantity,
  })
}

export async function notifyMessagingInvoiceIssued(input: {
  hqOrgId: string
  buyerOrgId: string
  createdByUserId?: string | null
  orderId: string
  orderNo: string
  invoiceNo: string
  invoiceTotal: number
}): Promise<void> {
  await notifyMessagingOrderTelegram({
    buyerOrgId: input.buyerOrgId,
    createdByUserId: input.createdByUserId,
    orderId: input.orderId,
    text: [
      `<b>Invoice issued</b>`,
      `Order: <b>${escapeTelegramHtml(input.orderNo)}</b>`,
      `Invoice: <b>${escapeTelegramHtml(input.invoiceNo)}</b>`,
      `Total: <b>RM ${input.invoiceTotal.toFixed(2)}</b>`,
      '',
      'This is the first time pricing is shown for this order.',
    ].join('\n'),
  })

  await notifyFinanceMessagingInvoice({
    hqOrgId: input.hqOrgId,
    orderId: input.orderId,
    orderNo: input.orderNo,
    invoiceNo: input.invoiceNo,
    invoiceTotal: input.invoiceTotal,
  })
}

export { formatMessagingStatusTelegram, notifyMessagingOrderTelegram }
