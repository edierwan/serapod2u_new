import { createAdminClient } from '@/lib/supabase/admin'
import { resolveOrgForSms } from '@/server/auth/passwordResetService'
import { outdoorPublicOrigin } from '@/lib/outdoor/auth-return'
import { normalizeMalaysianPhone } from '@/lib/storefront/customer-validation'
import { recordSmsDelivery, sendSmsWithActiveProvider } from '@/lib/notifications/sms-send'
import { outdoorMessageChannels, type OutdoorMessageEvent } from '@/lib/outdoor/customer-messages'
import { UNPAID_ORDER_TTL_HOURS } from '@/lib/storefront/unpaid-order-deadline'

export type OutdoorOrderSmsKind = OutdoorMessageEvent

export interface OutdoorOrderSmsOptions {
  /** The customer's money was returned as part of this change. */
  moneyReturned?: boolean
}

/** A Malaysian mobile number (01x) as +601…; landlines and anything else get no SMS. */
export function outdoorSmsPhone(raw: string | null | undefined): string | null {
  const phone = normalizeMalaysianPhone(raw)
  return phone && phone.startsWith('+601') ? phone : null
}

/** Plain ASCII so the gateway keeps it to one 160-character SMS. */
export function buildOutdoorOrderSms(
  kind: OutdoorOrderSmsKind,
  orderRef: string,
  origin: string,
  options: OutdoorOrderSmsOptions = {},
): string {
  const track = `${origin}/outdoor/track?order=${encodeURIComponent(orderRef)}`
  switch (kind) {
    case 'paid':
      return `[SeraOutdoor] Payment received for order ${orderRef}. Thank you! Track it here: ${track}`
    case 'shipped':
      return `[SeraOutdoor] Order ${orderRef} is on its way. Track it here: ${track}`
    case 'tracking_updated':
      return `[SeraOutdoor] New tracking number for order ${orderRef}. See it here: ${track}`
    case 'delivered':
      return `[SeraOutdoor] Order ${orderRef} has been delivered. Enjoy! Any problem? Report it from your order: ${origin}/outdoor/account`
    case 'auto_cancelled':
      return `[SeraOutdoor] Order ${orderRef} was cancelled because payment was not completed within ${UNPAID_ORDER_TTL_HOURS} hours. You have not been charged.`
    case 'cancelled':
      return `[SeraOutdoor] Order ${orderRef} has been cancelled. ${options.moneyReturned ? 'Your refund is on its way.' : 'You have not been charged.'} Questions? ${origin}/outdoor/contact`
    case 'refunded':
      return `[SeraOutdoor] Your refund for order ${orderRef} is on its way. It can take 5-10 business days to show.`
  }
}

/**
 * Texts the Outdoor customer through the active SMS provider, logged in SMS activity.
 * Skipped when staff turned SMS off for this event, without an SMS provider or
 * without a mobile number. Never throws.
 */
export async function notifyOutdoorOrderSms(orderId: string, kind: OutdoorOrderSmsKind, options: OutdoorOrderSmsOptions = {}) {
  try {
    const admin: any = createAdminClient()
    const { data: order } = await admin
      .from('storefront_orders')
      .select('order_ref, sales_channel, customer_phone')
      .eq('id', orderId)
      .maybeSingle()
    if (!order || order.sales_channel !== 'outdoor') return

    const to = outdoorSmsPhone(order.customer_phone)
    if (!to) return

    if (!(await outdoorMessageChannels(admin, kind)).sms) return

    const orgId = await resolveOrgForSms(admin)
    if (!orgId) return

    const result = await sendSmsWithActiveProvider(admin, orgId, to, buildOutdoorOrderSms(kind, String(order.order_ref), outdoorPublicOrigin(), options))
    await recordSmsDelivery(admin, { orgId, to, eventCode: `outdoor_order_${kind}`, result })
    if (!result.success) console.error(`[outdoor-order-sms] ${kind} SMS failed:`, result.error)
  } catch (err) {
    console.error(`[outdoor-order-sms] ${kind} SMS failed:`, err)
  }
}
