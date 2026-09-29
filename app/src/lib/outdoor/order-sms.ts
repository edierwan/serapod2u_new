import { createAdminClient } from '@/lib/supabase/admin'
import { resolveOrgForSms } from '@/server/auth/passwordResetService'
import { outdoorPublicOrigin } from '@/lib/outdoor/auth-return'
import { normalizeMalaysianPhone } from '@/lib/storefront/customer-validation'
import { recordSmsDelivery, sendSmsWithActiveProvider } from '@/lib/notifications/sms-send'
import {
  defaultOutdoorSmsTemplate,
  outdoorMessageSettings,
  renderOutdoorSms,
  type OutdoorOrderMessageEvent,
  type OutdoorSmsValues,
} from '@/lib/outdoor/customer-messages'

export type OutdoorOrderSmsKind = OutdoorOrderMessageEvent

export interface OutdoorOrderSmsOptions {
  /** The customer's money was returned as part of this change. */
  moneyReturned?: boolean
}

interface OrderForSms {
  order_ref: string
  customer_name?: string | null
  total_amount?: number | string | null
  currency?: string | null
  shipping_courier_name?: string | null
  shipping_tracking_no?: string | null
}

/** A Malaysian mobile number (01x) as +601…; landlines and anything else get no SMS. */
export function outdoorSmsPhone(raw: string | null | undefined): string | null {
  const phone = normalizeMalaysianPhone(raw)
  return phone && phone.startsWith('+601') ? phone : null
}

/** Plain ASCII values, so the built-in texts stay one 160-character SMS. */
export function outdoorSmsValues(order: OrderForSms, origin: string, options: OutdoorOrderSmsOptions = {}): OutdoorSmsValues {
  const ref = String(order.order_ref)
  const currency = String(order.currency || 'MYR').toUpperCase()
  const total = (Number(order.total_amount) || 0).toFixed(2)
  return {
    order_no: ref,
    first_name: String(order.customer_name || '').trim().split(/\s+/)[0] || '',
    amount: `${currency === 'MYR' ? 'RM' : currency} ${total}`,
    courier: String(order.shipping_courier_name || '').trim(),
    tracking_no: String(order.shipping_tracking_no || '').trim(),
    payment_note: options.moneyReturned ? 'Your refund is on its way.' : 'You have not been charged.',
    track_url: `${origin}/outdoor/track?order=${encodeURIComponent(ref)}`,
    account_url: `${origin}/outdoor/account`,
    contact_url: `${origin}/outdoor/contact`,
    shop_url: `${origin}/outdoor/shop`,
  }
}

/** The SMS for this event: staff wording when saved, otherwise the built-in text. */
export function buildOutdoorOrderSms(
  kind: OutdoorOrderSmsKind,
  order: string | OrderForSms,
  origin: string,
  options: OutdoorOrderSmsOptions = {},
  template?: string | null,
): string {
  const values = outdoorSmsValues(typeof order === 'string' ? { order_ref: order } : order, origin, options)
  return (template && renderOutdoorSms(template, values)) || renderOutdoorSms(defaultOutdoorSmsTemplate(kind), values)
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
      .select('order_ref, sales_channel, customer_phone, customer_name, total_amount, currency, shipping_courier_name, shipping_tracking_no')
      .eq('id', orderId)
      .maybeSingle()
    if (!order || order.sales_channel !== 'outdoor') return

    const to = outdoorSmsPhone(order.customer_phone)
    if (!to) return

    const settings = await outdoorMessageSettings(admin, kind)
    if (!settings.sms) return

    const orgId = await resolveOrgForSms(admin)
    if (!orgId) return

    const text = buildOutdoorOrderSms(kind, order, outdoorPublicOrigin(), options, settings.smsTemplate)
    const result = await sendSmsWithActiveProvider(admin, orgId, to, text)
    await recordSmsDelivery(admin, { orgId, to, eventCode: `outdoor_order_${kind}`, result })
    if (!result.success) console.error(`[outdoor-order-sms] ${kind} SMS failed:`, result.error)
  } catch (err) {
    console.error(`[outdoor-order-sms] ${kind} SMS failed:`, err)
  }
}
