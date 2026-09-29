export const OUTDOOR_INBOX = 'outdoor@serapod.com'
export const OUTDOOR_FROM = { fromName: 'SeraOutdoor', fromEmail: 'outdoor@serapod.com' }

export function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!))
}

export function money(amount: number, currency = 'MYR') {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency }).format(amount)
}

export function shell(title: string, body: string, cta: { href: string; label: string }) {
  return `<div style="font-family:Arial,sans-serif;color:#333f48;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px;color:#3f1c1f">${escapeHtml(title)}</h2>${body}
<p style="margin:22px 0 0"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#3f1c1f;color:#f1e6b2;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a></p></div>`
}
