import { SupabaseClient } from '@supabase/supabase-js'

import { type ShopRequestFormInput, sanitizeShopRequestForm, validateShopRequestForm } from '@/lib/shop-requests/core'
import {
    assessShopIdentity,
    decideShopCreation,
    type ShopIdentityConfirmations,
} from '@/lib/shop-requests/shop-identity-guard'
import { maskEmail } from '@/lib/auth/registration-otp-email'
import { EMAIL_REGEX } from '@/lib/utils/orgValidation'
import { normalizePhoneE164 } from '@/utils/phone'

import {
    RESEND_COOLDOWN_SECONDS,
    CHANNEL_WHATSAPP,
    SHOP_CONTACT_OTP_CHANNEL,
    checkResendRateLimit,
    checkSendRateLimit,
    createVerificationCode,
    findCodeByVerificationToken,
    generateOtp,
    hashOtp,
    invalidateExistingCodes,
    logNotificationEvent,
    sendOtpViaEmail,
} from './registrationVerificationService'

export const SHOP_CONTACT_VERIFICATION_PURPOSE = 'shop_contact_verification'

const SHOP_CONTACT_REQUEST_EVENT_TYPES = ['shop_contact_otp_requested', 'shop_contact_otp_resend']
const SHOP_CONTACT_RESEND_EVENT_TYPE = 'shop_contact_otp_resend'
const emailChannel: { channel: typeof SHOP_CONTACT_OTP_CHANNEL } = { channel: SHOP_CONTACT_OTP_CHANNEL }

export function resolveShopContactVerificationForm(input: ShopRequestFormInput) {
    const form = sanitizeShopRequestForm(input)
    const validation = validateShopRequestForm(form)

    return {
        form,
        validation,
    }
}

/** Confirmations captured at request-code time and replayed by /contact-verification/create. */
export function readShopContactIdentityConfirmations(meta: any): ShopIdentityConfirmations {
    const stored = meta?.identity_confirmations || {}
    return {
        confirmDifferentOutlet: stored.confirmDifferentOutlet === true,
        // The similar-name warning was already gated before the OTP was sent.
        confirmSimilarName: true,
    }
}

export async function startShopContactVerification(
    adminClient: SupabaseClient,
    input: {
        form: ShopRequestFormInput
        orgId: string
        confirmCreate?: boolean
        confirmDifferentOutlet?: boolean
        resend?: boolean
        ip?: string | null
        userAgent?: string | null
    },
) {
    const form = sanitizeShopRequestForm(input.form)
    const validation = validateShopRequestForm(form)

    if (!validation.valid) {
        return {
            ok: false as const,
            status: 400,
            body: { success: false, error: validation.errors[0] },
        }
    }

    const contactEmail = String(form.contactEmail || '').trim().toLowerCase()
    if (!contactEmail) {
        return {
            ok: false as const,
            status: 400,
            body: { success: false, error: 'Contact email is required to send the verification code.' },
        }
    }
    if (!EMAIL_REGEX.test(contactEmail)) {
        return {
            ok: false as const,
            status: 400,
            body: { success: false, error: 'Contact email is invalid.' },
        }
    }

    const identityConfirmations: ShopIdentityConfirmations = {
        confirmDifferentOutlet: input.confirmDifferentOutlet === true,
        confirmSimilarName: input.confirmCreate === true,
    }
    const identityDecision = decideShopCreation(
        await assessShopIdentity(adminClient, form),
        identityConfirmations,
    )
    if (!identityDecision.allowed) {
        return {
            ok: false as const,
            status: identityDecision.status,
            body: identityDecision.body,
        }
    }

    const normalizedPhone = normalizePhoneE164(form.contactPhone || '')
    const rateCheck = input.resend
        ? await checkResendRateLimit(adminClient, normalizedPhone, {
            purpose: SHOP_CONTACT_VERIFICATION_PURPOSE,
            resendEventType: SHOP_CONTACT_RESEND_EVENT_TYPE,
            channel: SHOP_CONTACT_OTP_CHANNEL,
        })
        : await checkSendRateLimit(adminClient, normalizedPhone, {
            purpose: SHOP_CONTACT_VERIFICATION_PURPOSE,
            requestEventTypes: SHOP_CONTACT_REQUEST_EVENT_TYPES,
            channel: SHOP_CONTACT_OTP_CHANNEL,
        })

    if (!rateCheck.allowed) {
        await logNotificationEvent(adminClient, {
            eventType: input.resend ? 'shop_contact_resend_rate_limited' : 'shop_contact_rate_limited',
            phone: normalizedPhone,
            email: contactEmail,
            channel: SHOP_CONTACT_OTP_CHANNEL,
            status: 'rate_limited',
            meta: {
                reason: input.resend ? 'resend_limit_exceeded' : 'send_limit_exceeded',
                shop_name: form.shopName,
                email: contactEmail,
            },
            ip: input.ip,
        })

        return {
            ok: false as const,
            status: 429,
            body: {
                success: false,
                error: input.resend
                    ? 'Please wait before requesting another verification code.'
                    : 'Too many verification requests were submitted for this shop. Please wait a moment before trying again.',
                resendCooldown: RESEND_COOLDOWN_SECONDS,
            },
        }
    }

    await invalidateExistingCodes(adminClient, normalizedPhone, {
        purpose: SHOP_CONTACT_VERIFICATION_PURPOSE,
        ...emailChannel,
    })
    // Clear any legacy WhatsApp codes for the same shop-contact purpose.
    await invalidateExistingCodes(adminClient, normalizedPhone, {
        purpose: SHOP_CONTACT_VERIFICATION_PURPOSE,
        channel: CHANNEL_WHATSAPP,
    })

    const code = generateOtp()
    const codeId = await createVerificationCode(
        adminClient,
        normalizedPhone,
        hashOtp(code),
        {
            org_id: input.orgId,
            shop_request: form,
            email: contactEmail,
            identity_confirmations: {
                confirmDifferentOutlet: identityConfirmations.confirmDifferentOutlet === true,
            },
        },
        input.ip || null,
        input.userAgent || null,
        { purpose: SHOP_CONTACT_VERIFICATION_PURPOSE, ...emailChannel },
    )

    const sendResult = await sendOtpViaEmail(
        adminClient,
        contactEmail,
        code,
        input.orgId,
        form.contactName,
        { template: 'shop_contact', shopName: form.shopName },
    )

    if (!sendResult.success) {
        await logNotificationEvent(adminClient, {
            eventType: 'shop_contact_otp_send_failed',
            phone: normalizedPhone,
            email: contactEmail,
            channel: SHOP_CONTACT_OTP_CHANNEL,
            status: 'failed',
            errorMessage: sendResult.error,
            meta: {
                codeId,
                org_id: input.orgId,
                shop_name: form.shopName,
                email: contactEmail,
                notConfigured: Boolean(sendResult.notConfigured),
                resend: Boolean(input.resend),
            },
            ip: input.ip,
        })

        return {
            ok: false as const,
            status: 500,
            body: {
                success: false,
                error: sendResult.notConfigured
                    ? 'Email verification is not configured yet. Please contact support.'
                    : input.resend
                        ? 'We could not resend the email verification code right now. Please try again.'
                        : 'We could not send the email verification code right now. Please try again shortly.',
            },
        }
    }

    await logNotificationEvent(adminClient, {
        eventType: input.resend ? 'shop_contact_otp_resend_sent' : 'shop_contact_otp_sent',
        phone: normalizedPhone,
        email: contactEmail,
        channel: SHOP_CONTACT_OTP_CHANNEL,
        status: 'sent',
        providerMessageId: sendResult.providerName || null,
        meta: {
            codeId,
            org_id: input.orgId,
            shop_name: form.shopName,
            email: contactEmail,
            email_org_id: sendResult.usedOrgId || input.orgId,
            resend: Boolean(input.resend),
        },
        ip: input.ip,
    })

    await logNotificationEvent(adminClient, {
        eventType: input.resend ? 'shop_contact_otp_resend' : 'shop_contact_otp_requested',
        phone: normalizedPhone,
        email: contactEmail,
        channel: SHOP_CONTACT_OTP_CHANNEL,
        status: 'sent',
        meta: {
            codeId,
            org_id: input.orgId,
            shop_name: form.shopName,
            email: contactEmail,
            resend: Boolean(input.resend),
        },
        ip: input.ip,
    })

    return {
        ok: true as const,
        status: 200,
        body: {
            success: true,
            message: input.resend
                ? `A fresh verification code has been sent to ${maskEmail(contactEmail)}.`
                : `A 4-digit verification code has been sent to ${maskEmail(contactEmail)}.`,
            resendCooldown: RESEND_COOLDOWN_SECONDS,
            contactPhone: normalizedPhone,
            contactEmail,
            channel: 'email',
            shopRequest: form,
        },
    }
}

export async function findVerifiedShopContactCode(
    adminClient: SupabaseClient,
    verificationToken: string,
) {
    return findCodeByVerificationToken(adminClient, verificationToken, {
        purpose: SHOP_CONTACT_VERIFICATION_PURPOSE,
        ...emailChannel,
    })
}

/**
 * Atomically claim a verified shop-contact code so a replayed or double-submitted
 * verification token cannot create two shops.
 *
 * Single conditional UPDATE (compiled by PostgREST to):
 *   UPDATE auth_verification_codes SET used_at = <claimedAt>
 *    WHERE id = <codeId> AND reset_token = <token> AND purpose = 'shop_contact_verification'
 *      AND channel = 'email' AND used_at IS NULL AND invalidated_at IS NULL
 *      AND reset_token_expires > now()
 *   RETURNING id
 * Under READ COMMITTED a concurrent second UPDATE blocks on the row lock, then
 * re-evaluates the WHERE clause against the committed row, sees used_at IS NOT NULL
 * and updates 0 rows — so exactly one request wins. Returns the claim timestamp,
 * or null when the token was already claimed/used/invalidated/expired.
 */
export async function claimVerifiedShopContactCode(
    adminClient: SupabaseClient,
    code: { id: string; reset_token: string },
): Promise<string | null> {
    const claimedAt = new Date().toISOString()
    const { data, error } = await adminClient
        .from('auth_verification_codes')
        .update({ used_at: claimedAt })
        .eq('id', code.id)
        .eq('reset_token', code.reset_token)
        .eq('purpose', SHOP_CONTACT_VERIFICATION_PURPOSE)
        .eq('channel', SHOP_CONTACT_OTP_CHANNEL)
        .is('used_at', null)
        .is('invalidated_at', null)
        .gt('reset_token_expires', claimedAt)
        .select('id')

    if (error) throw new Error(error.message || 'Unable to claim verification code.')
    return Array.isArray(data) && data.length > 0 ? claimedAt : null
}

/**
 * Release OUR claim when the shop was not created (duplicate conflict or error),
 * so the verification session is not consumed by a blocked attempt. Conditional on
 * used_at still equal to our own claim timestamp, so it can never re-open a code
 * that was consumed by another request or by a successful creation.
 */
export async function releaseShopContactCodeClaim(
    adminClient: SupabaseClient,
    codeId: string,
    claimedAt: string,
) {
    const { error } = await adminClient
        .from('auth_verification_codes')
        .update({ used_at: null })
        .eq('id', codeId)
        .eq('used_at', claimedAt)

    if (error) {
        console.warn('[shopContactVerification] failed to release code claim:', error.message)
    }
}
