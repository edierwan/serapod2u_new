const OTP_EXPIRY_MINUTES = 5
const PREVIEW_TEXT = 'Use this code to finish creating your Serapod2U account.'

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]!))
}

export function buildRegistrationOtpEmail(input: {
  code: string
  fullName?: string | null
}) {
  if (!/^\d{4}$/.test(input.code)) {
    throw new Error('Registration OTP must be exactly 4 digits.')
  }

  const greeting = input.fullName?.trim()
    ? `Hi ${input.fullName.trim()},`
    : 'Hi,'
  const subject = 'Your Serapod2U registration code'
  const code = input.code

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif;color:#101828"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(PREVIEW_TEXT)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f2f4f7"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" style="max-width:560px;border-collapse:separate;background:#ffffff;border:1px solid #e4e7ec;border-radius:16px;overflow:hidden"><tr><td style="padding:22px 28px;background:#c2410c;color:#ffffff;font-size:20px;font-weight:700">Serapod2U</td></tr><tr><td style="padding:28px"><div style="font-size:12px;font-weight:700;letter-spacing:1.4px;color:#c2410c">CREATE ACCOUNT</div><h1 style="margin:10px 0 12px;font-size:24px;line-height:1.3">Verify your email</h1><p style="margin:0 0 18px;color:#475467;line-height:1.6">${escapeHtml(greeting)}<br>Use the code below to finish creating your Serapod2U account.</p><table role="presentation" width="100%" style="border-collapse:collapse;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px"><tr><td align="center" style="padding:22px 16px"><div style="font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:#9a3412">Your verification code</div><div style="margin-top:10px;font-family:Consolas,Monaco,monospace;font-size:34px;font-weight:800;letter-spacing:8px;color:#9a3412">${escapeHtml(code)}</div><div style="margin-top:10px;font-size:13px;color:#9a3412">Valid for ${OTP_EXPIRY_MINUTES} minutes. Single use only.</div></td></tr></table><p style="margin:20px 0 0;color:#667085;font-size:13px;line-height:1.55">If you did not start registration, you can ignore this email.</p></td></tr><tr><td style="padding:16px 28px;background:#f9fafb;color:#667085;font-size:12px;line-height:1.5">Serapod2U will never ask you to share this code by reply email or phone.<br><strong style="color:#344054">Serapod2U</strong> · Automated security notification</td></tr></table></td></tr></table></body></html>`

  const text = [
    'SERAPOD2U — CREATE ACCOUNT',
    '',
    greeting,
    'Use the code below to finish creating your account.',
    '',
    `Your verification code: ${code}`,
    `This code expires in ${OTP_EXPIRY_MINUTES} minutes and can only be used once.`,
    '',
    'If you did not start registration, ignore this email.',
    '',
    'Serapod2U',
  ].join('\n')

  return { subject, html, text, previewText: PREVIEW_TEXT }
}

export function buildShopContactOtpEmail(input: {
  code: string
  fullName?: string | null
  shopName?: string | null
}) {
  if (!/^\d{4}$/.test(input.code)) {
    throw new Error('Shop contact OTP must be exactly 4 digits.')
  }

  const greeting = input.fullName?.trim()
    ? `Hi ${input.fullName.trim()},`
    : 'Hi,'
  const shopLabel = input.shopName?.trim() || 'your shop'
  const subject = 'Your Serapod2U shop verification code'
  const code = input.code
  const previewText = 'Use this code to verify the shop contact email.'

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif;color:#101828"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(previewText)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f2f4f7"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" style="max-width:560px;border-collapse:separate;background:#ffffff;border:1px solid #e4e7ec;border-radius:16px;overflow:hidden"><tr><td style="padding:22px 28px;background:#c2410c;color:#ffffff;font-size:20px;font-weight:700">Serapod2U</td></tr><tr><td style="padding:28px"><div style="font-size:12px;font-weight:700;letter-spacing:1.4px;color:#c2410c">CREATE SHOP</div><h1 style="margin:10px 0 12px;font-size:24px;line-height:1.3">Verify shop contact email</h1><p style="margin:0 0 18px;color:#475467;line-height:1.6">${escapeHtml(greeting)}<br>Use the code below to confirm the contact email for <strong>${escapeHtml(shopLabel)}</strong>.</p><table role="presentation" width="100%" style="border-collapse:collapse;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px"><tr><td align="center" style="padding:22px 16px"><div style="font-size:12px;text-transform:uppercase;letter-spacing:1.2px;color:#9a3412">Your verification code</div><div style="margin-top:10px;font-family:Consolas,Monaco,monospace;font-size:34px;font-weight:800;letter-spacing:8px;color:#9a3412">${escapeHtml(code)}</div><div style="margin-top:10px;font-size:13px;color:#9a3412">Valid for ${OTP_EXPIRY_MINUTES} minutes. Single use only.</div></td></tr></table><p style="margin:20px 0 0;color:#667085;font-size:13px;line-height:1.55">If you did not start shop creation, you can ignore this email.</p></td></tr><tr><td style="padding:16px 28px;background:#f9fafb;color:#667085;font-size:12px;line-height:1.5">Serapod2U will never ask you to share this code by reply email or phone.<br><strong style="color:#344054">Serapod2U</strong> · Automated security notification</td></tr></table></td></tr></table></body></html>`

  const text = [
    'SERAPOD2U — CREATE SHOP',
    '',
    greeting,
    `Use the code below to confirm the contact email for ${shopLabel}.`,
    '',
    `Your verification code: ${code}`,
    `This code expires in ${OTP_EXPIRY_MINUTES} minutes and can only be used once.`,
    '',
    'If you did not start shop creation, ignore this email.',
    '',
    'Serapod2U',
  ].join('\n')

  return { subject, html, text, previewText }
}

export function maskEmail(email: string): string {
  const value = String(email || '').trim().toLowerCase()
  const at = value.indexOf('@')
  if (at <= 0) return '***'
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`
}
