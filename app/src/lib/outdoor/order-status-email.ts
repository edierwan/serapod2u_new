import { createAdminClient } from '@/lib/supabase/admin'
import { sendTransactionalHtmlEmail } from '@/lib/email/transactional-html-email'
import { resolveOrgForEmail } from '@/server/auth/passwordResetService'
import { outdoorPublicOrigin } from '@/lib/outdoor/auth-return'
import { escapeHtml, money, OUTDOOR_FROM, shell } from '@/lib/outdoor/order-email-shell'
import { OWN_DELIVERY_LABEL } from '@/lib/storefront/delivery'
import { UNPAID_ORDER_TTL_HOURS } from '@/lib/storefront/unpaid-order-deadline'
import { notifyOutdoorOrderSms } from '@/lib/outdoor/order-sms'

export type OutdoorOrderEmailKind = 'shipped' | 'tracking_updated' | 'delivered' | 'auto_cancelled' | 'cancelled' | 'refunded'

export interface OutdoorOrderEmailOptions {
  /** The customer's money was returned as part of this change. */
  moneyReturned?: boolean
}

/**
 * Which email a staff status change sends to the customer, if any. Only Outdoor
 * orders, only real changes: re-saving the same status sends nothing, except a new
 * tracking number on an order that already shipped.
 */
export function outdoorOrderEmailFor(change: {
  salesChannel?: string | null
  fromStatus?: string | null
  toStatus: string
  fromTracking?: string | null
  toTracking?: string | null
  moneyReturned?: boolean
}): OutdoorOrderEmailKind | null {
  if (change.salesChannel !== 'outdoor') return null
  const toTracking = String(change.toTracking || '').trim()
  if (change.toStatus === 'shipped') {
    if (change.fromStatus !== 'shipped') return 'shipped'
    return toTracking && toTracking !== String(change.fromTracking || '').trim() ? 'tracking_updated' : null
  }
  if (change.fromStatus === change.toStatus) return null
  if (change.toStatus === 'delivered') return 'delivered'
  if (change.toStatus === 'cancelled') return 'cancelled'
  if (change.toStatus === 'refunded') return change.moneyReturned ? 'refunded' : null
  return null
}

interface OrderForEmail {
  order_ref: string
  customer_name?: string | null
  total_amount?: number | string | null
  currency?: string | null
  shipping_courier_name?: string | null
  shipping_tracking_no?: string | null
}

export function buildOutdoorOrderStatusEmail(
  kind: OutdoorOrderEmailKind,
  order: OrderForEmail,
  origin: string,
  options: OutdoorOrderEmailOptions = {},
): { subject: string; text: string; html: string } {
  const ref = String(order.order_ref)
  const firstName = String(order.customer_name || '').trim().split(/\s+/)[0]
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,'
  const total = money(Number(order.total_amount) || 0, order.currency || 'MYR')
  const courier = String(order.shipping_courier_name || '').trim()
  const tracking = String(order.shipping_tracking_no || '').trim()
  const ownDelivery = courier === OWN_DELIVERY_LABEL

  const trackCta = { href: `${origin}/outdoor/track?order=${encodeURIComponent(ref)}`, label: 'Track my order' }
  const contactCta = { href: `${origin}/outdoor/contact`, label: 'Contact us' }
  const refundLine = `We have refunded ${total} to your original payment method. Depending on your bank, it can take 5–10 business days to show.`

  let subject: string
  let title: string
  let lines: string[]
  let cta: { href: string; label: string }

  switch (kind) {
    case 'shipped':
    case 'tracking_updated':
      subject = kind === 'shipped' ? `Order ${ref} is on its way` : `New tracking number for order ${ref}`
      title = kind === 'shipped' ? 'Your order is on its way' : 'Your tracking number was updated'
      lines = ownDelivery
        ? [`Good news: order ${ref} has left our warehouse. Our own delivery team is bringing it to you.`]
        : [
            kind === 'shipped'
              ? `Good news: order ${ref} has left our warehouse${courier ? ` with ${courier}` : ''}.`
              : `We updated the courier details for order ${ref}${courier ? ` (${courier})` : ''}.`,
            tracking ? `Tracking number: ${tracking}` : '',
          ]
      cta = trackCta
      break
    case 'delivered':
      subject = `Order ${ref} has been delivered`
      title = 'Your order has arrived'
      lines = [
        `Order ${ref} has been delivered. We hope you enjoy it!`,
        'If anything is wrong with it, sign in to your account, open the order and tap Report a problem.',
      ]
      cta = trackCta
      break
    case 'auto_cancelled':
      subject = `Order ${ref} was cancelled`
      title = 'Your order was cancelled'
      lines = [
        `Payment for order ${ref} was not completed within ${UNPAID_ORDER_TTL_HOURS} hours, so we cancelled it. You have not been charged.`,
        'The items are still in our shop if you would like to order again.',
      ]
      cta = { href: `${origin}/outdoor/shop`, label: 'Shop again' }
      break
    case 'cancelled':
      subject = `Order ${ref} was cancelled`
      title = 'Your order was cancelled'
      lines = [
        `Order ${ref} has been cancelled.`,
        options.moneyReturned ? refundLine : 'You have not been charged.',
        'If you have any questions, get in touch with us.',
      ]
      cta = contactCta
      break
    case 'refunded':
      subject = `Refund for order ${ref}`
      title = 'Your refund is on its way'
      lines = [refundLine, 'If you have any questions, get in touch with us.']
      cta = contactCta
      break
  }

  const body = lines.filter(Boolean)
  return {
    subject,
    text: [greeting, ...body, `${cta.label}: ${cta.href}`].join('\n\n'),
    html: shell(
      title,
      [greeting, ...body].map((line) => `<p style="margin:0 0 12px;line-height:1.55">${escapeHtml(line)}</p>`).join('\n'),
      cta,
    ),
  }
}

/**
 * Emails the customer about an Outdoor order change; a delivery is also sent by SMS.
 * Never throws: the change itself is already saved.
 */
export async function notifyOutdoorOrderStatus(
  orderId: string,
  kind: OutdoorOrderEmailKind | null,
  options: OutdoorOrderEmailOptions = {},
) {
  if (!kind) return
  await Promise.all([
    emailOutdoorOrderStatus(orderId, kind, options),
    kind === 'delivered' ? notifyOutdoorOrderSms(orderId, 'delivered') : null,
  ])
}

async function emailOutdoorOrderStatus(orderId: string, kind: OutdoorOrderEmailKind, options: OutdoorOrderEmailOptions) {
  try {
    const admin: any = createAdminClient()
    const { data: order } = await admin
      .from('storefront_orders')
      .select('order_ref, sales_channel, customer_name, customer_email, total_amount, currency, shipping_courier_name, shipping_tracking_no')
      .eq('id', orderId)
      .maybeSingle()
    if (!order || order.sales_channel !== 'outdoor' || !order.customer_email) return

    const orgId = await resolveOrgForEmail(admin)
    if (!orgId) return

    const email = buildOutdoorOrderStatusEmail(kind, order, outdoorPublicOrigin(), options)
    const sent = await sendTransactionalHtmlEmail(admin, orgId, { to: order.customer_email, ...email, ...OUTDOOR_FROM })
    if (!sent.success) console.error(`[outdoor-order-email] ${kind} email failed:`, sent.error)
  } catch (err) {
    console.error(`[outdoor-order-email] ${kind} email failed:`, err)
  }
}
