/**
 * POST /api/auth/password-reset/request
 *
 * Accept email, lookup consumer, generate OTP, send via email provider
 * from Dynamic Configuration. Always returns a generic success message.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidEmail, normalizeEmail } from '@/lib/auth/password-reset-otp-email'
import {
    lookupConsumerByEmail,
    checkSendRateLimit,
    invalidateExistingCodes,
    generateOtp,
    hashOtp,
    createVerificationCode,
    sendOtpViaEmail,
    logNotificationEvent,
    resolveOrgForEmail,
    RESEND_COOLDOWN_SECONDS,
    GENERIC_EMAIL_OTP_MESSAGE,
} from '@/server/auth/passwordResetService'

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const emailRaw: string | undefined = body?.email

        if (!emailRaw || typeof emailRaw !== 'string' || !isValidEmail(emailRaw)) {
            return NextResponse.json(
                { error: 'Please enter a valid email address.' },
                { status: 400 },
            )
        }

        const email = normalizeEmail(emailRaw)
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
        const ua = req.headers.get('user-agent') || null
        const admin = createAdminClient()

        const rateCheck = await checkSendRateLimit(admin, email)
        if (!rateCheck.allowed) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_rate_limited',
                email,
                status: 'rate_limited',
                meta: { reason: 'send_limit_exceeded' },
                ip,
            })
            return NextResponse.json({
                message: GENERIC_EMAIL_OTP_MESSAGE,
                resendCooldown: RESEND_COOLDOWN_SECONDS,
            })
        }

        const consumer = await lookupConsumerByEmail(admin, email)
        if (!consumer) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_otp_requested',
                email,
                status: 'no_account',
                meta: { anonymous: true },
                ip,
            })
            return NextResponse.json({
                message: GENERIC_EMAIL_OTP_MESSAGE,
                resendCooldown: RESEND_COOLDOWN_SECONDS,
            })
        }

        await invalidateExistingCodes(admin, email)

        const code = generateOtp()
        const codeHash = hashOtp(code)
        const codeId = await createVerificationCode(
            admin,
            email,
            codeHash,
            consumer.userId,
            ip,
            ua,
            consumer.phone,
        )

        const orgId = await resolveOrgForEmail(admin)
        if (!orgId) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_otp_send_failed',
                email,
                phone: consumer.phone,
                userId: consumer.userId,
                status: 'failed',
                errorMessage: 'No email provider configured',
                meta: { codeId },
                ip,
            })
            return NextResponse.json({
                message: GENERIC_EMAIL_OTP_MESSAGE,
                resendCooldown: RESEND_COOLDOWN_SECONDS,
            })
        }

        const sendResult = await sendOtpViaEmail(admin, email, code, orgId, consumer.fullName)

        if (sendResult.success) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_otp_sent',
                email,
                phone: consumer.phone,
                userId: consumer.userId,
                status: 'sent',
                provider: sendResult.providerName,
                meta: { codeId },
                ip,
            })
        } else {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_otp_send_failed',
                email,
                phone: consumer.phone,
                userId: consumer.userId,
                status: 'failed',
                provider: sendResult.providerName,
                errorMessage: sendResult.error,
                meta: { codeId, notConfigured: sendResult.notConfigured === true },
                ip,
            })
        }

        await logNotificationEvent(admin, {
            eventType: 'password_reset_otp_requested',
            email,
            phone: consumer.phone,
            userId: consumer.userId,
            status: sendResult.success ? 'sent' : 'send_failed',
            provider: sendResult.providerName,
            ip,
        })

        return NextResponse.json({
            message: GENERIC_EMAIL_OTP_MESSAGE,
            resendCooldown: RESEND_COOLDOWN_SECONDS,
        })
    } catch (err: any) {
        console.error('Password reset request error:', err)
        return NextResponse.json(
            { error: 'Something went wrong. Please try again later.' },
            { status: 500 },
        )
    }
}
