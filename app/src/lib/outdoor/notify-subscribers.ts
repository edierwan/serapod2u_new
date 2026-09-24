import { sendTransactionalHtmlEmail } from '@/lib/email/transactional-html-email'
import { resolveOrgForEmail } from '@/server/auth/passwordResetService'

export async function emailOutdoorSubscribers(
  admin: any,
  input: { subject: string; text: string; html: string },
) {
  const { data: subscribers, error } = await admin
    .from('outdoor_newsletter_subscribers')
    .select('email_normalized')
    .limit(500)

  if (error) {
    return { ok: false as const, error: 'Could not load subscribers.', emailed: 0, subscribers: 0 }
  }

  const orgId = await resolveOrgForEmail(admin)
  if (!orgId) {
    return { ok: false as const, error: 'Email is not configured.', emailed: 0, subscribers: (subscribers || []).length }
  }

  let emailed = 0
  for (const row of subscribers || []) {
    const to = String(row.email_normalized || '').trim()
    if (!to.includes('@')) continue
    const sent = await sendTransactionalHtmlEmail(admin, orgId, {
      to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      fromName: 'SeraOutdoor',
      fromEmail: 'outdoor@serapod.com',
    })
    if (sent.success) emailed += 1
  }

  return { ok: true as const, emailed, subscribers: (subscribers || []).length }
}
