import { SupabaseClient } from '@supabase/supabase-js'

import { type ShopRequestFormInput, sanitizeShopRequestForm, validateShopRequestForm } from '@/lib/shop-requests/core'
import { findShopDuplicateConflicts } from '@/lib/shop-requests/create-shop'
import { normalizePhoneE164 } from '@/utils/phone'

import {
    OTP_EXPIRY_MINUTES,
    RESEND_COOLDOWN_SECONDS,
    checkResendRateLimit,
    checkSendRateLimit,
    createVerificationCode,
    findCodeByVerificationToken,
    generateOtp,
    hashOtp,
    invalidateExistingCodes,
    logNotificationEvent,
    sendOtpViaWhatsApp,
} from './registrationVerificationService'

export const SHOP_CONTACT_VERIFICATION_PURPOSE = 'shop_contact_verification'

const SHOP_CONTACT_REQUEST_EVENT_TYPES = ['shop_contact_otp_requested', 'shop_contact_otp_resend']
const SHOP_CONTACT_RESEND_EVENT_TYPE = 'shop_contact_otp_resend'

function buildShopContactVerificationMessage(code: string) {
    return (
        `Serapod2U shop contact verification code: *${code}*\n\n` +
        `Please enter this 4-digit code to confirm the shop contact mobile number. ` +
        `This code will expire in ${OTP_EXPIRY_MINUTES} minutes.\n\n` +
        `If you did not request this shop creation, no further action is required.`
    )
}

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
        })
        : await checkSendRateLimit(adminClient, normalizedPhone, {
            purpose: SHOP_CONTACT_VERIFICATION_PURPOSE,
            requestEventTypes: SHOP_CONTACT_REQUEST_EVENT_TYPES,
        })

    if (!rateCheck.allowed) {
        await logNotificationEvent(adminClient, {
            eventType: input.resend ? 'shop_contact_resend_rate_limited' : 'shop_contact_rate_limited',
            phone: normalizedPhone,
            status: 'rate_limited',
            meta: {
                reason: input.resend ? 'resend_limit_exceeded' : 'send_limit_exceeded',
                shop_name: form.shopName,
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
                    : 'Too many verification requests were submitted for this number. Please wait a moment before trying again.',
                resendCooldown: RESEND_COOLDOWN_SECONDS,
            },
        }
    }

    await invalidateExistingCodes(adminClient, normalizedPhone, {
        purpose: SHOP_CONTACT_VERIFICATION_PURPOSE,
    })

    const code = generateOtp()
    const codeId = await createVerificationCode(
        adminClient,
        normalizedPhone,
        hashOtp(code),
        {
            org_id: input.orgId,
            shop_request: form,
        },
        input.ip || null,
        input.userAgent || null,
        { purpose: SHOP_CONTACT_VERIFICATION_PURPOSE },
    )

    const sendResult = await sendOtpViaWhatsApp(adminClient, normalizedPhone, code, input.orgId, {
        message: buildShopContactVerificationMessage(code),
    })

    if (!sendResult.success) {
        await logNotificationEvent(adminClient, {
            eventType: 'shop_contact_otp_send_failed',
            phone: normalizedPhone,
            status: 'failed',
            errorMessage: sendResult.error,
            meta: {
                codeId,
                org_id: input.orgId,
                shop_name: form.shopName,
                resend: Boolean(input.resend),
            },
            ip: input.ip,
        })

        return {
            ok: false as const,
            status: 500,
            body: {
                success: false,
                error: input.resend
                    ? 'We could not resend the verification code right now. Please try again.'
                    : 'We could not send the WhatsApp verification code right now. Please try again shortly.',
            },
        }
    }

    await logNotificationEvent(adminClient, {
        eventType: input.resend ? 'shop_contact_otp_resend_sent' : 'shop_contact_otp_sent',
        phone: normalizedPhone,
        status: 'sent',
        providerMessageId: sendResult.providerMessageId,
        meta: {
            codeId,
            org_id: input.orgId,
            shop_name: form.shopName,
            resend: Boolean(input.resend),
        },
        ip: input.ip,
    })

    await logNotificationEvent(adminClient, {
        eventType: input.resend ? 'shop_contact_otp_resend' : 'shop_contact_otp_requested',
        phone: normalizedPhone,
        status: 'sent',
        meta: {
            codeId,
            org_id: input.orgId,
            shop_name: form.shopName,
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
                ? 'A fresh WhatsApp verification code has been sent to the shop contact mobile number.'
                : 'A 4-digit WhatsApp verification code has been sent to the shop contact mobile number.',
            resendCooldown: RESEND_COOLDOWN_SECONDS,
            contactPhone: normalizedPhone,
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
    })
}