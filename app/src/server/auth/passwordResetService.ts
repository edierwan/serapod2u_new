/**
 * Password Reset OTP Service
 *
 * Handles OTP generation, hashing, verification, and lifecycle management
 * for the WhatsApp-based password reset flow.
 *
 * Tables used:
 *   - auth_verification_codes  – stores hashed OTP, expiry, attempts
 *   - notification_events      – audit trail for every action
 *   - users                    – consumer lookup by phone
 *
 * All OTP generation/verification is server-side only.
 */

import crypto from 'crypto'
import { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhoneE164 } from '@/utils/phone'

// ── Constants ───────────────────────────────────────────────────────────
export const OTP_LENGTH = 4
export const OTP_EXPIRY_MINUTES = 5
export const RESEND_COOLDOWN_SECONDS = 60
export const MAX_SEND_ATTEMPTS_PER_15MIN = 3
export const MAX_VERIFY_ATTEMPTS_PER_OTP = 5
export const MAX_RESEND_PER_15MIN = 5
export const RESET_TOKEN_EXPIRY_MINUTES = 10

const PURPOSE = 'password_reset'
const CHANNEL = 'whatsapp'
const PROVIDER = 'baileys'

// ── Helpers ─────────────────────────────────────────────────────────────

/** Generate a cryptographically secure 4-digit OTP */
export function generateOtp(): string {
  const num = crypto.randomInt(0, 10000)
  return num.toString().padStart(OTP_LENGTH, '0')
}

/** SHA-256 hash (sufficient for a 4-digit code with short expiry + rate limits) */
export function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

/** Generate a short-lived reset token (opaque, URL-safe) */
export function generateResetToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

// ── User Lookup ─────────────────────────────────────────────────────────

export interface ConsumerLookupResult {
  userId: string
  email: string
  fullName: string | null
  phone: string
}

/**
 * Look up a consumer/user by phone number.
 * Returns null if not found (callers must NOT reveal existence to client).
 */
export async function lookupConsumerByPhone(
  admin: SupabaseClient,
  phoneRaw: string
): Promise<ConsumerLookupResult | null> {
  const phone = normalizePhoneE164(phoneRaw)
  const phoneDigits = phone.replace(/^\+/, '')

  // Query with both +60 and 60 formats (separate queries to avoid PostgREST .or() encoding issues)
  let data: any = null

  const { data: d1 } = await admin
    .from('users')
    .select('id, email, full_name, phone')
    .eq('phone', phone)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  data = d1

  if (!data) {
    const { data: d2 } = await admin
      .from('users')
      .select('id, email, full_name, phone')
      .eq('phone', phoneDigits)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    data = d2
  }

  if (!data) return null
  return {
    userId: data.id,
    email: data.email,
    fullName: data.full_name,
    phone: phone,
  }
}

// ── Rate Limiting (DB-based) ────────────────────────────────────────────

/** Check if too many OTP sends happened recently for this phone */
export async function checkSendRateLimit(
  admin: SupabaseClient,
  phone: string
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  const { count } = await admin
    .from('notification_events')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_phone', phone)
    .eq('purpose', PURPOSE)
    .in('event_type', ['password_reset_otp_requested', 'password_reset_otp_resend'])
    .gte('created_at', since)

  if ((count ?? 0) >= MAX_SEND_ATTEMPTS_PER_15MIN) {
    return { allowed: false, retryAfterSec: 60 }
  }
  return { allowed: true }
}

/** Check resend rate limit */
export async function checkResendRateLimit(
  admin: SupabaseClient,
  phone: string
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  const { count } = await admin
    .from('notification_events')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_phone', phone)
    .eq('purpose', PURPOSE)
    .eq('event_type', 'password_reset_otp_resend')
    .gte('created_at', since)

  if ((count ?? 0) >= MAX_RESEND_PER_15MIN) {
    return { allowed: false, retryAfterSec: 60 }
  }
  return { allowed: true }
}

// ── OTP Lifecycle ───────────────────────────────────────────────────────

/** Invalidate all existing active codes for a phone + purpose */
export async function invalidateExistingCodes(
  admin: SupabaseClient,
  phone: string
) {
  await admin
    .from('auth_verification_codes')
    .update({ invalidated_at: new Date().toISOString() })
    .eq('phone_normalized', phone)
    .eq('purpose', PURPOSE)
    .eq('channel', CHANNEL)
    .is('invalidated_at', null)
    .is('used_at', null)
}

/** Create a new verification code row */
export async function createVerificationCode(
  admin: SupabaseClient,
  phone: string,
  codeHash: string,
  userId: string | null,
  ip: string | null,
  userAgent: string | null
): Promise<string> {
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString()

  const { data, error } = await admin
    .from('auth_verification_codes')
    .insert({
      purpose: PURPOSE,
      channel: CHANNEL,
      phone_normalized: phone,
      user_id: userId,
      code_hash: codeHash,
      expires_at: expiresAt,
      max_attempts: MAX_VERIFY_ATTEMPTS_PER_OTP,
      request_ip: ip,
      request_user_agent: userAgent,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Failed to create verification code: ${error.message}`)
  return data.id
}

/** Find the latest active (non-invalidated, non-used, non-expired) code */
export async function findActiveCode(
  admin: SupabaseClient,
  phone: string
) {
  const { data, error } = await admin
    .from('auth_verification_codes')
    .select('*')
    .eq('phone_normalized', phone)
    .eq('purpose', PURPOSE)
    .eq('channel', CHANNEL)
    .is('invalidated_at', null)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return null
  return data
}

/** Increment attempt_count on a code */
export async function incrementAttemptCount(
  admin: SupabaseClient,
  codeId: string,
  currentCount: number
) {
  await admin
    .from('auth_verification_codes')
    .update({ attempt_count: currentCount + 1 })
    .eq('id', codeId)
}

/** Mark code as verified and issue reset token */
export async function markCodeVerified(
  admin: SupabaseClient,
  codeId: string
): Promise<string> {
  const resetToken = generateResetToken()
  const resetTokenExpires = new Date(
    Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000
  ).toISOString()

  await admin
    .from('auth_verification_codes')
    .update({
      verified_at: new Date().toISOString(),
      reset_token: resetToken,
      reset_token_expires: resetTokenExpires,
    })
    .eq('id', codeId)

  return resetToken
}

/** Mark code as used (password changed) */
export async function markCodeUsed(
  admin: SupabaseClient,
  codeId: string
) {
  await admin
    .from('auth_verification_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', codeId)
}

/** Find a verified code by reset token */
export async function findCodeByResetToken(
  admin: SupabaseClient,
  resetToken: string
) {
  const { data } = await admin
    .from('auth_verification_codes')
    .select('*')
    .eq('reset_token', resetToken)
    .eq('purpose', PURPOSE)
    .is('used_at', null)
    .is('invalidated_at', null)
    .gt('reset_token_expires', new Date().toISOString())
    .limit(1)
    .maybeSingle()

  return data
}

// ── Notification Event Logging ──────────────────────────────────────────

export async function logNotificationEvent(
  admin: SupabaseClient,
  params: {
    eventType: string
    phone: string
    userId?: string | null
    status: string
    providerMessageId?: string | null
    errorCode?: string | null
    errorMessage?: string | null
    meta?: Record<string, any>
    ip?: string | null
  }
) {
  const now = new Date().toISOString()
  const sentTypes = [
    'password_reset_otp_sent',
    'password_reset_otp_resend_sent',
  ]
  const verifiedTypes = ['password_reset_otp_verified']
  const completedTypes = ['password_reset_password_updated']

  await admin.from('notification_events').insert({
    channel: CHANNEL,
    provider: PROVIDER,
    event_type: params.eventType,
    purpose: PURPOSE,
    recipient_phone: params.phone,
    user_id: params.userId ?? null,
    status: params.status,
    provider_message_id: params.providerMessageId ?? null,
    error_code: params.errorCode ?? null,
    error_message: params.errorMessage ?? null,
    meta: params.meta ?? {},
    request_ip: params.ip ?? null,
    requested_at: now,
    sent_at: sentTypes.includes(params.eventType) ? now : null,
    verified_at: verifiedTypes.includes(params.eventType) ? now : null,
    completed_at: completedTypes.includes(params.eventType) ? now : null,
    created_at: now,
  })
}

// ── WhatsApp Send ───────────────────────────────────────────────────────

/**
 * Send OTP via WhatsApp using the Baileys gateway.
 * Re-uses the existing gateway calling pattern from _utils.ts
 */
export async function sendOtpViaWhatsApp(
  admin: SupabaseClient,
  phone: string,
  code: string,
  orgId: string
): Promise<{ success: boolean; providerMessageId?: string; error?: string }> {
  // Dynamic import to avoid circular deps
  const { getWhatsAppConfig, callGateway } = await import(
    '@/app/api/settings/whatsapp/_utils'
  )

  const config = await getWhatsAppConfig(admin, orgId)
  if (!config?.baseUrl || !config?.apiKey) {
    return { success: false, error: 'WhatsApp not configured for this organization' }
  }

  // Phone to send to: strip + for Baileys (expects 60xxxx format or full digits)
  const recipientDigits = phone.replace(/^\+/, '')

  const message =
    `Your Serapod2U reset code is *${code}*. This code expires in ${OTP_EXPIRY_MINUTES} minutes. ` +
    `If you did not request this, please ignore this message.`

  try {
    const result = await callGateway(
      config.baseUrl,
      config.apiKey,
      'POST',
      '/messages/send',
      { phone: recipientDigits, message },
      config.tenantId
    )

    return {
      success: true,
      providerMessageId: result?.key?.id || result?.messageId || null,
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'WhatsApp send failed' }
  }
}

// ── Resolve Organization for public consumer OTP ────────────────────────

/**
 * Find the org that owns the WhatsApp provider config.
 * For public (unauthenticated) flows, we need to determine which org to
 * query for gateway config. We look for the first org with an active
 * Baileys WhatsApp provider.
 */
export async function resolveOrgForWhatsApp(
  admin: SupabaseClient
): Promise<string | null> {
  const { data } = await admin
    .from('notification_provider_configs')
    .select('org_id')
    .eq('channel', 'whatsapp')
    .in('provider_name', ['baileys', 'baileys_home'])
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  return data?.org_id ?? null
}
