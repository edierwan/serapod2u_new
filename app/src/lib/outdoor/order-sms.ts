import { createAdminClient } from '@/lib/supabase/admin'
import { resolveOrgForSms } from '@/server/auth/passwordResetService'
import { outdoorPublicOrigin } from '@/lib/outdoor/auth-return'
import { normalizeMalaysianPhone } from '@/lib/storefront/customer-validation'
import { recordSmsDelivery, sendSmsWithActiveProvider } from '@/lib/notifications/sms-send'

export type OutdoorOrderSmsKind = 'paid' | 'delivered'

const EVENT_CODES: Record<OutdoorOrderSmsKind, string> = {
  paid: 'outdoor_order_paid',
  delivered: 'outdoor_order_delivered',
}

/** A Malaysian mobile number (01x) as +601…; landlines and anything else get no SMS. */
export function outdoorSmsPhone(raw: string | null | undefined): string | null {
  const phone = normalizeMalaysianPhone(raw)
  return phone && phone.startsWith('+601') ? phone : null
}

/** Plain ASCII so the gateway keeps it to one 160-character SMS. */
export function buildOutdoorOrderSms(kind: OutdoorOrderSmsKind, orderRef: string, origin: string): string {
  if (kind === 'paid') {
    return `[SeraOutdoor] Payment received for order ${orderRef}. Thank you! Track it here: ${origin}/outdoor/track?order=${encodeURIComponent(orderRef)}`
  }
  return `[SeraOutdoor] Order ${orderRef} has been delivered. Enjoy! Any problem? Report it from your order: ${origin}/outdoor/account`
}

/**
 * Texts the Outdoor customer through the active SMS provider, logged in SMS activity.
 * Skipped without an SMS provider or a mobile number. Never throws.
 */
export async function notifyOutdoorOrderSms(orderId: string, kind: OutdoorOrderSmsKind) {
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

    const orgId = await resolveOrgForSms(admin)
    if (!orgId) return

    const result = await sendSmsWithActiveProvider(admin, orgId, to, buildOutdoorOrderSms(kind, String(order.order_ref), outdoorPublicOrigin()))
    await recordSmsDelivery(admin, { orgId, to, eventCode: EVENT_CODES[kind], result })
    if (!result.success) console.error(`[outdoor-order-sms] ${kind} SMS failed:`, result.error)
  } catch (err) {
    console.error(`[outdoor-order-sms] ${kind} SMS failed:`, err)
  }
}
