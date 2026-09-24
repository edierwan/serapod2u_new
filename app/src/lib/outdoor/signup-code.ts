import { createHash, randomInt } from 'node:crypto'
import { sendTransactionalHtmlEmail } from '@/lib/email/transactional-html-email'
import { outdoorPublicOrigin } from '@/lib/outdoor/product-email'
import { resolveOrgForEmail } from '@/server/auth/passwordResetService'

const PURPOSE = 'outdoor_signup'
const CHANNEL = 'email'
const OTP_MINUTES = 5
const MAX_SENDS = 3
const MAX_ATTEMPTS = 5

function hashCode(code: string) {
  return createHash('sha256').update(code).digest('hex')
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

async function findAuthUserId(email: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_PUBLIC_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) return null
  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users?page=1&per_page=20&filter=${encodeURIComponent(email)}`,
    {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      cache: 'no-store',
    },
  )
  if (!response.ok) return null
  const body = await response.json().catch(() => null)
  const users = Array.isArray(body?.users) ? body.users : []
  const match = users.find((user: { email?: string }) => String(user.email || '').trim().toLowerCase() === email)
  return match?.id ? String(match.id) : null
}

export async function outdoorEmailTaken(admin: any, email: string) {
  const { data: profile } = await admin
    .from('users')
    .select('id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle()
  if (profile?.id) return true
  return Boolean(await findAuthUserId(email))
}

export async function sendOutdoorSignupCode(admin: any, emailRaw: string, fullName: string) {
  const email = normalizeEmail(emailRaw)
  if (!email.includes('@') || email.length > 254) {
    return { ok: false as const, status: 400, error: 'A valid email is required.' }
  }
  if (!fullName.trim()) {
    return { ok: false as const, status: 400, error: 'Name is required.' }
  }
  if (await outdoorEmailTaken(admin, email)) {
    return { ok: false as const, status: 409, error: 'This email already has an account. Sign in instead.' }
  }

  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const recent = await admin
    .from('auth_verification_codes')
    .select('id, created_at')
    .eq('email_normalized', email)
    .eq('purpose', PURPOSE)
    .gte('created_at', since)
  const rows = recent.data || []
  if (rows.length >= MAX_SENDS) {
    return { ok: false as const, status: 429, error: 'Too many codes. Wait 15 minutes, then try again.' }
  }
  const newest = rows
    .map((row: { created_at?: string }) => new Date(row.created_at || 0).getTime())
    .sort((a: number, b: number) => b - a)[0]
  if (newest && Date.now() - newest < 60_000) {
    return { ok: false as const, status: 429, error: 'Wait a minute before sending another code.' }
  }

  await admin
    .from('auth_verification_codes')
    .update({ invalidated_at: new Date().toISOString() })
    .eq('email_normalized', email)
    .eq('purpose', PURPOSE)
    .eq('channel', CHANNEL)
    .is('invalidated_at', null)
    .is('used_at', null)

  const code = randomInt(0, 10000).toString().padStart(4, '0')
  const expiresAt = new Date(Date.now() + OTP_MINUTES * 60 * 1000).toISOString()
  const { error: insertError } = await admin.from('auth_verification_codes').insert({
    purpose: PURPOSE,
    channel: CHANNEL,
    email_normalized: email,
    phone_normalized: null,
    code_hash: hashCode(code),
    expires_at: expiresAt,
    max_attempts: MAX_ATTEMPTS,
    meta: { full_name: fullName.trim().slice(0, 120) },
  })
  if (insertError) {
    console.error('[outdoor/signup-code]', insertError)
    return { ok: false as const, status: 500, error: 'Could not send the code.' }
  }

  const orgId = await resolveOrgForEmail(admin)
  if (!orgId) return { ok: false as const, status: 500, error: 'Could not send the code.' }

  const origin = outdoorPublicOrigin()
  const sent = await sendTransactionalHtmlEmail(admin, orgId, {
    to: email,
    subject: 'Your SeraOutdoor code',
    text: `Your SeraOutdoor verification code is ${code}. It expires in ${OTP_MINUTES} minutes.`,
    html: `<div style="font-family:Arial,sans-serif;background:#f1e6b2;padding:24px"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden"><div style="background:#3f1c1f;padding:20px 24px"><img src="${origin}/outdoor/brand/logo.png" alt="SeraOutdoor" width="180" style="display:block;width:180px;height:auto;border:0"></div><div style="padding:24px"><p style="margin:0;color:#2e1416;font-size:16px">Your verification code</p><p style="margin:16px 0 0;font-size:32px;letter-spacing:8px;font-weight:700;color:#3f1c1f">${code}</p><p style="margin:16px 0 0;color:#6d5a52;font-size:14px">Expires in ${OTP_MINUTES} minutes.</p></div></div></div>`,
    fromName: 'SeraOutdoor',
    fromEmail: 'outdoor@serapod.com',
  })
  if (!sent.success) {
    return { ok: false as const, status: 500, error: 'Could not send the code.' }
  }
  return { ok: true as const }
}

export async function completeOutdoorSignup(admin: any, input: { email: string; code: string; password: string; fullName: string }) {
  const email = normalizeEmail(input.email)
  const code = String(input.code || '').trim()
  const password = String(input.password || '')
  const fullName = String(input.fullName || '').trim().slice(0, 120)
  if (!email.includes('@') || !/^\d{4}$/.test(code)) {
    return { ok: false as const, status: 400, error: 'Enter the 4-digit code.' }
  }
  if (password.length < 8) {
    return { ok: false as const, status: 400, error: 'Password must be at least 8 characters.' }
  }

  const { data: active } = await admin
    .from('auth_verification_codes')
    .select('id, code_hash, attempt_count, max_attempts')
    .eq('email_normalized', email)
    .eq('purpose', PURPOSE)
    .eq('channel', CHANNEL)
    .is('invalidated_at', null)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!active) {
    return { ok: false as const, status: 400, error: 'That code expired. Send a new one.' }
  }
  const attempts = Number(active.attempt_count || 0)
  const maxAttempts = Number(active.max_attempts || MAX_ATTEMPTS)
  if (attempts >= maxAttempts) {
    return { ok: false as const, status: 429, error: 'Too many tries. Send a new code.' }
  }
  if (hashCode(code) !== active.code_hash) {
    await admin.from('auth_verification_codes').update({ attempt_count: attempts + 1 }).eq('id', active.id)
    return { ok: false as const, status: 400, error: 'That code is not correct.' }
  }
  if (await outdoorEmailTaken(admin, email)) {
    return { ok: false as const, status: 409, error: 'This email already has an account. Sign in instead.' }
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (createError || !created?.user) {
    const message = String(createError?.message || '')
    if (/already|registered|exists/i.test(message)) {
      return { ok: false as const, status: 409, error: 'This email already has an account. Sign in instead.' }
    }
    console.error('[outdoor/signup-code] create', createError)
    return { ok: false as const, status: 500, error: 'Could not create the account.' }
  }

  await admin.from('auth_verification_codes').update({
    used_at: new Date().toISOString(),
    verified_at: new Date().toISOString(),
    user_id: created.user.id,
  }).eq('id', active.id)

  return { ok: true as const }
}
