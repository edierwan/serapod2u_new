import { sendTransactionalHtmlEmail } from '@/lib/email/transactional-html-email'
import { outdoorPublicOrigin } from '@/lib/outdoor/product-email'
import { resolveOrgForEmail } from '@/server/auth/passwordResetService'

const FROM = { fromName: 'SeraOutdoor', fromEmail: 'outdoor@serapod.com' }

export function stampOutdoorUnsubscribe(html: string, text: string, url: string) {
  const linkHtml = url
    ? ` <a href="${url}" style="color:#3f1c1f;text-decoration:underline;">Unsubscribe</a>`
    : ''
  const linkText = url ? `\nUnsubscribe: ${url}` : ''
  return {
    html: html.split('{{unsubscribe_url}}').join(linkHtml),
    text: text.split('{{unsubscribe_url}}').join(linkText),
  }
}

export function outdoorUnsubscribeUrl(token: string) {
  return `${outdoorPublicOrigin()}/outdoor/unsubscribe?token=${encodeURIComponent(token)}`
}

async function ensureUnsubscribeToken(admin: any, row: { id?: string; unsubscribe_token?: string }) {
  const existing = String(row.unsubscribe_token || '').trim()
  if (existing) return existing
  if (!row.id) return ''
  const token = crypto.randomUUID()
  const saved = await admin
    .from('outdoor_newsletter_subscribers')
    .update({ unsubscribe_token: token })
    .eq('id', row.id)
  return saved.error ? '' : token
}

export async function countOutdoorSubscribers(admin: any) {
  const filtered = await admin
    .from('outdoor_newsletter_subscribers')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
  if (!filtered.error) return filtered.count || 0
  if (/status/i.test(filtered.error.message || '')) {
    const all = await admin
      .from('outdoor_newsletter_subscribers')
      .select('id', { count: 'exact', head: true })
    return all.count || 0
  }
  return 0
}

export async function emailOutdoorSubscribers(
  admin: any,
  input: { subject: string; text: string; html: string },
) {
  let rows: Array<{ id?: string; email_normalized?: string; unsubscribe_token?: string }> | null = null
  let canUnsubscribe = true
  const filtered = await admin
    .from('outdoor_newsletter_subscribers')
    .select('id, email_normalized, unsubscribe_token')
    .eq('status', 'active')
    .limit(500)

  if (filtered.error && /status|unsubscribe_token/i.test(filtered.error.message || '')) {
    canUnsubscribe = false
    const legacy = await admin
      .from('outdoor_newsletter_subscribers')
      .select('email_normalized')
      .limit(500)
    if (legacy.error) {
      return { ok: false as const, error: 'Could not load subscribers.', emailed: 0, subscribers: 0 }
    }
    rows = legacy.data
  } else if (filtered.error) {
    return { ok: false as const, error: 'Could not load subscribers.', emailed: 0, subscribers: 0 }
  } else {
    rows = filtered.data
  }

  const orgId = await resolveOrgForEmail(admin)
  const list = rows || []
  if (!orgId) {
    return { ok: false as const, error: 'Email is not configured.', emailed: 0, subscribers: list.length }
  }

  let emailed = 0
  for (const row of list) {
    const to = String(row.email_normalized || '').trim()
    if (!to.includes('@')) continue
    const token = canUnsubscribe ? await ensureUnsubscribeToken(admin, row) : ''
    const stamped = stampOutdoorUnsubscribe(
      input.html,
      input.text,
      token ? outdoorUnsubscribeUrl(token) : '',
    )
    const sent = await sendTransactionalHtmlEmail(admin, orgId, {
      to,
      subject: input.subject,
      text: stamped.text,
      html: stamped.html,
      ...FROM,
    })
    if (sent.success) emailed += 1
  }

  return { ok: true as const, emailed, subscribers: list.length }
}

export async function sendOutdoorSubscriberEmail(
  admin: any,
  to: string,
  input: { subject: string; text: string; html: string },
) {
  const orgId = await resolveOrgForEmail(admin)
  if (!orgId) return { success: false as const, error: 'Email is not configured.' }
  return sendTransactionalHtmlEmail(admin, orgId, { to, ...input, ...FROM })
}
