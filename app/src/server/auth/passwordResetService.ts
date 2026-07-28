/**
 * Password Reset OTP Service
 *
 * Consumer Collect Points / loyalty forgot-password flow.
 * Primary channel: email (Dynamic Config email providers).
 * WhatsApp helpers remain for legacy/admin use only.
 *
 * Tables:
 *   - auth_verification_codes
 *   - notification_events
 *   - users
 *   - notification_provider_configs
 */

import crypto from 'crypto'
import { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhoneE164, toProviderPhone } from '@/utils/phone'
import { sendTransactionalHtmlEmail } from '@/lib/email/transactional-html-email'
import {
    buildPasswordResetOtpEmail,
    isValidEmail,
    normalizeEmail,
} from '@/lib/auth/password-reset-otp-email'

export const OTP_LENGTH = 4
export const OTP_EXPIRY_MINUTES = 5
export const RESEND_COOLDOWN_SECONDS = 60
export const MAX_SEND_ATTEMPTS_PER_15MIN = 3
export const MAX_VERIFY_ATTEMPTS_PER_OTP = 5
export const MAX_RESEND_PER_15MIN = 5
export const RESET_TOKEN_EXPIRY_MINUTES = 10

const PURPOSE = 'password_reset'
/** Consumer password-reset OTP uses email (Dynamic Config / notification providers). */
export const CHANNEL = 'email' as const
const EMAIL_PROVIDER_FALLBACK = 'email'

export function generateOtp(): string {
    const num = crypto.randomInt(0, 10000)
    return num.toString().padStart(OTP_LENGTH, '0')
}

export function hashOtp(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex')
}

export function generateResetToken(): string {
    return crypto.randomBytes(32).toString('base64url')
}

export interface ConsumerLookupResult {
    userId: string
    email: string
    fullName: string | null
    phone: string | null
}

export async function lookupConsumerByEmail(
    admin: SupabaseClient,
    emailRaw: string,
): Promise<ConsumerLookupResult | null> {
    const email = normalizeEmail(emailRaw)
    if (!isValidEmail(email)) return null

    const { data } = await admin
        .from('users')
        .select('id, email, full_name, phone')
        .ilike('email', email)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

    if (!data?.email) return null
    return {
        userId: data.id,
        email: normalizeEmail(data.email),
        fullName: data.full_name,
        phone: data.phone ? normalizePhoneE164(data.phone) : null,
    }
}

/** @deprecated Prefer lookupConsumerByEmail for consumer Collect Points reset. */
export async function lookupConsumerByPhone(
    admin: SupabaseClient,
    phoneRaw: string,
): Promise<ConsumerLookupResult | null> {
    const phone = normalizePhoneE164(phoneRaw)
    const phoneDigits = phone.replace(/^\+/, '')

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
        email: normalizeEmail(data.email || ''),
        fullName: data.full_name,
        phone,
    }
}

export async function checkSendRateLimit(
    admin: SupabaseClient,
    email: string,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count } = await admin
        .from('notification_events')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_email', email)
        .eq('purpose', PURPOSE)
        .in('event_type', ['password_reset_otp_requested', 'password_reset_otp_resend'])
        .gte('created_at', since)

    if ((count ?? 0) >= MAX_SEND_ATTEMPTS_PER_15MIN) {
        return { allowed: false, retryAfterSec: 60 }
    }
    return { allowed: true }
}

export async function checkResendRateLimit(
    admin: SupabaseClient,
    email: string,
): Promise<{ allowed: boolean; retryAfterSec?: number }> {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count } = await admin
        .from('notification_events')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_email', email)
        .eq('purpose', PURPOSE)
        .eq('event_type', 'password_reset_otp_resend')
        .gte('created_at', since)

    if ((count ?? 0) >= MAX_RESEND_PER_15MIN) {
        return { allowed: false, retryAfterSec: 60 }
    }
    return { allowed: true }
}

export async function invalidateExistingCodes(
    admin: SupabaseClient,
    email: string,
) {
    await admin
        .from('auth_verification_codes')
        .update({ invalidated_at: new Date().toISOString() })
        .eq('email_normalized', email)
        .eq('purpose', PURPOSE)
        .eq('channel', CHANNEL)
        .is('invalidated_at', null)
        .is('used_at', null)
}

export async function createVerificationCode(
    admin: SupabaseClient,
    email: string,
    codeHash: string,
    userId: string | null,
    ip: string | null,
    userAgent: string | null,
    phone?: string | null,
): Promise<string> {
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString()

    const { data, error } = await admin
        .from('auth_verification_codes')
        .insert({
            purpose: PURPOSE,
            channel: CHANNEL,
            email_normalized: email,
            phone_normalized: phone || null,
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

export async function findActiveCode(
    admin: SupabaseClient,
    email: string,
) {
    const { data, error } = await admin
        .from('auth_verification_codes')
        .select('*')
        .eq('email_normalized', email)
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

export async function incrementAttemptCount(
    admin: SupabaseClient,
    codeId: string,
    currentCount: number,
) {
    await admin
        .from('auth_verification_codes')
        .update({ attempt_count: currentCount + 1 })
        .eq('id', codeId)
}

export async function markCodeVerified(
    admin: SupabaseClient,
    codeId: string,
): Promise<string> {
    const resetToken = generateResetToken()
    const resetTokenExpires = new Date(
        Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000,
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

export async function markCodeUsed(
    admin: SupabaseClient,
    codeId: string,
) {
    await admin
        .from('auth_verification_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('id', codeId)
}

export async function findCodeByResetToken(
    admin: SupabaseClient,
    resetToken: string,
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

export async function logNotificationEvent(
    admin: SupabaseClient,
    params: {
        eventType: string
        email: string
        phone?: string | null
        userId?: string | null
        status: string
        provider?: string | null
        providerMessageId?: string | null
        errorCode?: string | null
        errorMessage?: string | null
        meta?: Record<string, any>
        ip?: string | null
    },
) {
    const now = new Date().toISOString()
    const sentTypes = ['password_reset_otp_sent', 'password_reset_otp_resend_sent']
    const verifiedTypes = ['password_reset_otp_verified']
    const completedTypes = ['password_reset_password_updated']

    await admin.from('notification_events').insert({
        channel: CHANNEL,
        provider: params.provider || EMAIL_PROVIDER_FALLBACK,
        event_type: params.eventType,
        purpose: PURPOSE,
        recipient_email: params.email,
        recipient_phone: params.phone ?? null,
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

export async function sendOtpViaEmail(
    admin: SupabaseClient,
    email: string,
    code: string,
    orgId: string,
    fullName?: string | null,
): Promise<{ success: boolean; providerName?: string; error?: string; notConfigured?: boolean }> {
    try {
        const built = buildPasswordResetOtpEmail({ code, fullName })
        const result = await sendTransactionalHtmlEmail(admin, orgId, {
            to: email,
            subject: built.subject,
            text: built.text,
            html: built.html,
            fromName: 'Serapod2U',
        })
        if (!result.success) {
            return {
                success: false,
                notConfigured: result.notConfigured,
                error: result.error || 'Email send failed',
                providerName: result.providerName,
            }
        }
        return { success: true, providerName: result.providerName || EMAIL_PROVIDER_FALLBACK }
    } catch (err: any) {
        return { success: false, error: err.message || 'Email send failed' }
    }
}

/** Resolve org that owns an active email provider (Dynamic Config → Providers). */
export async function resolveOrgForEmail(
    admin: SupabaseClient,
): Promise<string | null> {
    const { data: preferred } = await admin
        .from('notification_provider_configs')
        .select('org_id')
        .eq('channel', 'email')
        .eq('is_default', true)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
    if (preferred?.org_id) return preferred.org_id

    const { data: anyActive } = await admin
        .from('notification_provider_configs')
        .select('org_id')
        .eq('channel', 'email')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    return anyActive?.org_id ?? null
}

/** Legacy WhatsApp send — kept for compatibility; consumer reset uses email. */
export async function sendOtpViaWhatsApp(
    admin: SupabaseClient,
    phone: string,
    code: string,
    orgId: string,
): Promise<{ success: boolean; providerMessageId?: string; error?: string }> {
    const { sendWhatsAppMessage } = await import('@/app/api/settings/whatsapp/_utils')
    const recipientDigits = toProviderPhone(phone)
    if (!recipientDigits) return { success: false, error: 'Invalid phone number' }

    const message =
        `Your Serapod2U reset code is *${code}*. This code expires in ${OTP_EXPIRY_MINUTES} minutes. ` +
        `If you did not request this, please ignore this message.`

    try {
        const sent = await sendWhatsAppMessage(admin, orgId, { to: recipientDigits, text: message })
        const result = sent.response
        return {
            success: true,
            providerMessageId: result?.key?.id || result?.messageId || null,
        }
    } catch (err: any) {
        return { success: false, error: err.message || 'WhatsApp send failed' }
    }
}

export async function resolveOrgForWhatsApp(
    admin: SupabaseClient,
): Promise<string | null> {
    const { data } = await admin
        .from('notification_provider_configs')
        .select('org_id')
        .eq('channel', 'whatsapp')
        .eq('is_default', true)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()

    return data?.org_id ?? null
}

export const GENERIC_EMAIL_OTP_MESSAGE =
    'If this email exists, we will send a verification code via email.'
