import { createAdminClient } from '@/lib/supabase/admin'
import { sendTransactionalHtmlEmail } from '@/lib/email/transactional-html-email'
import { resolveOrgForEmail } from '@/server/auth/passwordResetService'
import { outdoorPublicOrigin } from '@/lib/outdoor/auth-return'

const OUTDOOR_INBOX = 'outdoor@serapod.com'
const OUTDOOR_FROM = { fromName: 'SeraOutdoor', fromEmail: 'outdoor@serapod.com' }

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!))
}

function money(amount: number, currency = 'MYR') {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency }).format(amount)
}

function shell(title: string, body: string, cta: { href: string; label: string }) {
  return `<div style="font-family:Arial,sans-serif;color:#333f48;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px;color:#3f1c1f">${escapeHtml(title)}</h2>${body}
<p style="margin:22px 0 0"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#3f1c1f;color:#f1e6b2;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a></p></div>`
}

/** Sent once, when an Outdoor order first becomes paid. /store orders are left alone. */
export async function notifyOutdoorOrderPaid(orderId: string) {
  const admin: any = createAdminClient()
  const { data: order } = await admin
    .from('storefront_orders')
    .select('order_ref, sales_channel, customer_name, customer_email, customer_phone, total_amount, shipping_amount, currency, shipping_address, storefront_order_items(product_name, variant_name, quantity, subtotal)')
    .eq('id', orderId)
    .maybeSingle()
  if (!order || order.sales_channel !== 'outdoor' || !order.customer_email) return

  const orgId = await resolveOrgForEmail(admin)
  if (!orgId) return

  const currency = order.currency || 'MYR'
  const items: any[] = order.storefront_order_items || []
  const shipping = Number(order.shipping_amount) || 0
  const total = Number(order.total_amount) || 0
  const addr = order.shipping_address || {}
  const address = [addr.line1, addr.line2, [addr.postcode, addr.city].filter(Boolean).join(' '), addr.state]
    .filter(Boolean)
    .join(', ')
  const origin = outdoorPublicOrigin()
  const ref = String(order.order_ref)
  const firstName = String(order.customer_name || '').trim().split(/\s+/)[0]

  const rowsHtml = items
    .map(
      (item) =>
        `<tr><td style="padding:6px 0">${escapeHtml(item.product_name)}${item.variant_name ? ` · ${escapeHtml(item.variant_name)}` : ''} × ${Number(item.quantity) || 1}</td><td style="padding:6px 0;text-align:right">${money(Number(item.subtotal) || 0, currency)}</td></tr>`,
    )
    .join('')
  const summaryHtml = `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">${rowsHtml}
<tr><td style="padding:6px 0;border-top:1px solid #e5e1cf">Shipping</td><td style="padding:6px 0;border-top:1px solid #e5e1cf;text-align:right">${shipping > 0 ? money(shipping, currency) : 'Free'}</td></tr>
<tr><td style="padding:6px 0;font-weight:700">Total</td><td style="padding:6px 0;text-align:right;font-weight:700">${money(total, currency)}</td></tr></table>`
  const summaryText = [
    ...items.map((item) => `${item.product_name}${item.variant_name ? ` · ${item.variant_name}` : ''} × ${item.quantity}  ${money(Number(item.subtotal) || 0, currency)}`),
    `Shipping: ${shipping > 0 ? money(shipping, currency) : 'Free'}`,
    `Total: ${money(total, currency)}`,
  ].join('\n')

  const trackLink = `${origin}/outdoor/track?order=${encodeURIComponent(ref)}`
  const customer = await sendTransactionalHtmlEmail(admin, orgId, {
    to: order.customer_email,
    subject: `Order ${ref} confirmed — thank you!`,
    text: [
      firstName ? `Hi ${firstName},` : 'Hi,',
      `Thank you for your order. Payment for ${ref} is confirmed.`,
      summaryText,
      address ? `Delivering to: ${address}` : '',
      'We pack your order and hand it to the courier within 1–3 business days. The tracking number appears on your order when it ships.',
      `Track your order: ${trackLink}`,
    ].filter(Boolean).join('\n\n'),
    html: shell(
      'Your order is confirmed',
      `<p style="margin:0 0 12px;line-height:1.55">${firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,'}</p>
<p style="margin:0 0 12px;line-height:1.55">Thank you for your order. Payment for <strong>${escapeHtml(ref)}</strong> is confirmed.</p>
${summaryHtml}
${address ? `<p style="margin:0 0 12px;line-height:1.55;font-size:13px;color:#7c878e"><strong style="color:#3f1c1f">Delivering to</strong> ${escapeHtml(address)}</p>` : ''}
<p style="margin:0;line-height:1.55">We pack your order and hand it to the courier within 1–3 business days. The tracking number appears on your order when it ships.</p>`,
      { href: trackLink, label: 'Track my order' },
    ),
    ...OUTDOOR_FROM,
  })
  if (!customer.success) console.error('[outdoor-order-paid] customer email failed:', customer.error)

  const deskLink = `${origin}/outdoor/fulfilment`
  const staff = await sendTransactionalHtmlEmail(admin, orgId, {
    to: OUTDOOR_INBOX,
    subject: `New paid order ${ref} · ${money(total, currency)}`,
    text: [
      `Order: ${ref}`,
      `Customer: ${order.customer_name || ''} <${order.customer_email}> ${order.customer_phone || ''}`,
      summaryText,
      address ? `Deliver to: ${address}` : '',
      `Open the desk: ${deskLink}`,
    ].filter(Boolean).join('\n\n'),
    html: shell(
      `New paid order ${ref}`,
      `<p style="margin:0 0 12px;line-height:1.55"><strong>Customer:</strong> ${escapeHtml(order.customer_name || '')} &lt;${escapeHtml(order.customer_email)}&gt; ${escapeHtml(order.customer_phone || '')}</p>
${summaryHtml}
${address ? `<p style="margin:0;line-height:1.55;font-size:13px"><strong>Deliver to:</strong> ${escapeHtml(address)}</p>` : ''}`,
      { href: deskLink, label: 'Open fulfilment desk' },
    ),
    ...OUTDOOR_FROM,
  })
  if (!staff.success) console.error('[outdoor-order-paid] staff email failed:', staff.error)
}
