import crypto from 'crypto'
import { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhoneE164 } from '@/utils/phone'

export const OTP_LENGTH = 4
export const OTP_EXPIRY_MINUTES = 5
export const RESEND_COOLDOWN_SECONDS = 60
export const MAX_SEND_ATTEMPTS_PER_15MIN = 3
export const MAX_VERIFY_ATTEMPTS_PER_OTP = 5
export const MAX_RESEND_PER_15MIN = 5
export const VERIFICATION_TOKEN_EXPIRY_MINUTES = 15

const PURPOSE = 'registration_verification'
const CHANNEL = 'whatsapp'
const PROVIDER = 'baileys'

export function generateOtp(): string {
    const num = crypto.randomInt(0, 10000)
    return num.toString().padStart(OTP_LENGTH, '0')
}

export function hashOtp(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex')
}

function generateVerificationToken(): string {
    return crypto.randomBytes(32).toString('base64url')
}

export async function checkRegistrationAvailability(
    admin: SupabaseClient,
    emailRaw: string,
    phoneRaw: string,
) {
    const email = emailRaw.trim().toLowerCase()
    const phone = normalizePhoneE164(phoneRaw.trim())

    const { data: emailMatch, error: emailError } = await admin
        .from('users')
        .select('id')
        .ilike('email', email)
        .limit(1)

    if (emailError) {
        throw new Error(`Email availability check failed: ${emailError.message}`)
    }

    const { data: phoneExists, error: phoneError } = await admin
        .rpc('check_phone_exists', {
            p_phone: phone,
            p_exclude_user_id: null,
        })

    if (phoneError) {
        throw new Error(`Phone availability check failed: ${phoneError.message}`)
    }

    return {
        emailAvailable: !emailMatch || emailMatch.length === 0,
        phoneAvailable: !phoneExists,
        normalizedPhone: phone,
    }
}

export async function checkSendRateLimit(admin: SupabaseClient, phone: string) {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    const { count } = await admin
        .from('notification_events')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_phone', phone)
        .eq('purpose', PURPOSE)
        .in('event_type', ['registration_otp_requested', 'registration_otp_resend'])
        .gte('created_at', since)

    if ((count ?? 0) >= MAX_SEND_ATTEMPTS_PER_15MIN) {
        return { allowed: false, retryAfterSec: RESEND_COOLDOWN_SECONDS }
    }

    return { allowed: true }
}

export async function checkResendRateLimit(admin: SupabaseClient, phone: string) {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    const { count } = await admin
        .from('notification_events')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_phone', phone)
        .eq('purpose', PURPOSE)
        .eq('event_type', 'registration_otp_resend')
        .gte('created_at', since)

    if ((count ?? 0) >= MAX_RESEND_PER_15MIN) {
        return { allowed: false, retryAfterSec: RESEND_COOLDOWN_SECONDS }
    }

    return { allowed: true }
}

export async function invalidateExistingCodes(admin: SupabaseClient, phone: string) {
    await admin
        .from('auth_verification_codes')
        .update({ invalidated_at: new Date().toISOString() })
        .eq('phone_normalized', phone)
        .eq('purpose', PURPOSE)
        .eq('channel', CHANNEL)
        .is('invalidated_at', null)
        .is('used_at', null)
}

export async function createVerificationCode(
    admin: SupabaseClient,
    phone: string,
    codeHash: string,
    meta: Record<string, any>,
    ip: string | null,
    userAgent: string | null,
) {
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString()

    const { data, error } = await admin
        .from('auth_verification_codes')
        .insert({
            purpose: PURPOSE,
            channel: CHANNEL,
            phone_normalized: phone,
            code_hash: codeHash,
            expires_at: expiresAt,
            max_attempts: MAX_VERIFY_ATTEMPTS_PER_OTP,
            request_ip: ip,
            request_user_agent: userAgent,
            meta,
        })
        .select('id')
        .single()

    if (error) {
        throw new Error(`Failed to create verification code: ${error.message}`)
    }

    return data.id as string
}

export async function findActiveCode(admin: SupabaseClient, phone: string) {
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

export async function incrementAttemptCount(admin: SupabaseClient, codeId: string, currentCount: number) {
    await admin
        .from('auth_verification_codes')
        .update({ attempt_count: currentCount + 1 })
        .eq('id', codeId)
}

export async function markCodeVerified(admin: SupabaseClient, codeId: string) {
    const verificationToken = generateVerificationToken()
    const verificationTokenExpires = new Date(
        Date.now() + VERIFICATION_TOKEN_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString()

    await admin
        .from('auth_verification_codes')
        .update({
            verified_at: new Date().toISOString(),
            reset_token: verificationToken,
            reset_token_expires: verificationTokenExpires,
        })
        .eq('id', codeId)

    return verificationToken
}

export async function findCodeByVerificationToken(admin: SupabaseClient, verificationToken: string) {
    const { data } = await admin
        .from('auth_verification_codes')
        .select('*')
        .eq('reset_token', verificationToken)
        .eq('purpose', PURPOSE)
        .is('used_at', null)
        .is('invalidated_at', null)
        .gt('reset_token_expires', new Date().toISOString())
        .limit(1)
        .maybeSingle()

    return data
}

export async function markCodeUsed(admin: SupabaseClient, codeId: string, userId: string) {
    await admin
        .from('auth_verification_codes')
        .update({
            used_at: new Date().toISOString(),
            user_id: userId,
        })
        .eq('id', codeId)
}

export async function logNotificationEvent(
    admin: SupabaseClient,
    params: {
        eventType: string
        phone: string
        status: string
        userId?: string | null
        providerMessageId?: string | null
        errorCode?: string | null
        errorMessage?: string | null
        meta?: Record<string, any>
        ip?: string | null
    },
) {
    const now = new Date().toISOString()
    const sentTypes = ['registration_otp_sent', 'registration_otp_resend_sent']
    const verifiedTypes = ['registration_otp_verified']
    const completedTypes = ['registration_completed']

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

export async function sendOtpViaWhatsApp(
    admin: SupabaseClient,
    phone: string,
    code: string,
    orgId: string,
): Promise<{ success: boolean; providerMessageId?: string | null; error?: string }> {
    const { getWhatsAppConfig, callGateway } = await import('@/app/api/settings/whatsapp/_utils')

    const config = await getWhatsAppConfig(admin, orgId)
    if (!config?.baseUrl || !config?.apiKey) {
        return { success: false, error: 'WhatsApp gateway is not configured for registration verification.' }
    }

    const recipientDigits = phone.replace(/^\+/, '')
    const message =
        `Serapod2U registration verification code: *${code}*\n\n` +
        `Please enter this 4-digit code to confirm your mobile number. ` +
        `This code will expire in ${OTP_EXPIRY_MINUTES} minutes.\n\n` +
        `If you did not request this registration, no further action is required.`

    try {
        const result = await callGateway(
            config.baseUrl,
            config.apiKey,
            'POST',
            '/messages/send',
            { to: recipientDigits, text: message },
            config.tenantId,
        )

        return {
            success: true,
            providerMessageId: result?.key?.id || result?.messageId || null,
        }
    } catch (error: any) {
        return { success: false, error: error?.message || 'WhatsApp send failed' }
    }
}
