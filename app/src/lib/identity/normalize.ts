/**
 * Canonical identifier normalization for identity resolution.
 *
 * Mirrors public.identity_normalize_email / public.identity_normalize_phone
 * (supabase/migrations/20260929110000_identity_foundation.sql) exactly; the
 * shared case table in normalize.test.ts keeps both in lock-step.
 *
 * Email and phone are login aliases and resolution keys — never primary keys.
 * The identity key is always the auth.users.id = public.users.id UUID.
 */

const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/

/** trim + lowercase; null when empty or malformed. */
export function normalizeIdentityEmail(email: string | null | undefined): string | null {
  const value = String(email ?? '').trim().toLowerCase()
  if (!value) return null
  return EMAIL_PATTERN.test(value) ? value : null
}

/**
 * Strict E.164 (+CC…). Accepts explicit international numbers (+… / 00…),
 * Malaysian national numbers (01x…, 03…) and Malaysian numbers written with
 * the country code but no plus (601x…). Anything else returns null: a number
 * without a country prefix is never assigned a guessed country.
 */
export function normalizeIdentityPhone(phone: string | null | undefined): string | null {
  const raw = String(phone ?? '').trim()
  if (!raw) return null
  if (!/^\+?[0-9 ()./-]+$/.test(raw)) return null
  const digits = raw.replace(/[^0-9]/g, '')
  if (!digits) return null

  let e164: string
  if (raw.startsWith('+')) e164 = digits
  else if (digits.startsWith('00')) e164 = digits.slice(2)
  else if (/^0[1-9][0-9]{7,9}$/.test(digits)) e164 = `60${digits.slice(1)}`
  else if (/^60[1-9][0-9]{7,9}$/.test(digits)) e164 = digits
  else return null

  if (!/^[1-9][0-9]{7,14}$/.test(e164)) return null
  if (e164.startsWith('60') && !/^60[1-9][0-9]{7,9}$/.test(e164)) return null
  return `+${e164}`
}
