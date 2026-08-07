import { SupabaseClient } from '@supabase/supabase-js'

import { type ShopRequestFormInput, sanitizeShopRequestForm, validateShopRequestForm } from '@/lib/shop-requests/core'
import { findShopDuplicateConflicts } from '@/lib/shop-requests/create-shop'
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
const emailChannel = { channel: SHOP_CONTACT_OTP_CHANNEL as const }

export function resolveShopContactVerificationForm(input: ShopRequestFormInput) {
    const form = sanitizeShopRequestForm(input)
    const validation = validateShopRequestForm(form)

    return {
        form,
        validation,
    }
}

export async function checkShopContactDuplicateState(
    adminClient: SupabaseClient,
    form: ShopRequestFormInput,
) {
    return findShopDuplicateConflicts(adminClient, form)
}

export async function startShopContactVerification(
    adminClient: SupabaseClient,
    input: {
        form: ShopRequestFormInput
        orgId: string
        confirmCreate?: boolean
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

    const duplicates = await findShopDuplicateConflicts(adminClient, form)
    if (duplicates.exactMatches.length > 0) {
        return {
            ok: false as const,
            status: 409,
            body: {
                success: false,
                duplicateBlocked: true,
                duplicates: duplicates.exactMatches,
                error: 'A shop with this phone number or name already exists. Please select it from the existing shop list.',
            },
        }
    }

    if (duplicates.fuzzyMatches.length > 0 && !input.confirmCreate) {
        return {
            ok: false as const,
            status: 409,
            body: {
                success: false,
                duplicateWarning: true,
                duplicates: duplicates.fuzzyMatches,
                error: 'Similar shops already exist. Please confirm creation.',
            },
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
