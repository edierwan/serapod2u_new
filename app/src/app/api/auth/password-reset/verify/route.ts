/**
 * POST /api/auth/password-reset/verify
 *
 * Verify the 4-digit email OTP and issue a short-lived reset token.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidEmail, normalizeEmail } from '@/lib/auth/password-reset-otp-email'
import {
    findActiveCode,
    hashOtp,
    incrementAttemptCount,
    markCodeVerified,
    logNotificationEvent,
} from '@/server/auth/passwordResetService'

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const emailRaw: string | undefined = body?.email
        const code: string | undefined = body?.code

        if (!emailRaw || !code || typeof code !== 'string') {
            return NextResponse.json({ error: 'Email and code are required.' }, { status: 400 })
        }

        if (!isValidEmail(emailRaw)) {
            return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
        }

        if (!/^\d{4}$/.test(code)) {
            return NextResponse.json({ error: 'Code must be a 4-digit number.' }, { status: 400 })
        }

        const email = normalizeEmail(emailRaw)
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
        const admin = createAdminClient()

        const activeCode = await findActiveCode(admin, email)
        if (!activeCode) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_otp_verify_failed',
                email,
                status: 'failed',
                errorMessage: 'No active code found or code expired',
                ip,
            })
            return NextResponse.json(
                { error: 'Code expired or invalid. Please request a new code.' },
                { status: 400 },
            )
        }

        if (activeCode.attempt_count >= activeCode.max_attempts) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_otp_verify_failed',
                email,
                phone: activeCode.phone_normalized,
                userId: activeCode.user_id,
                status: 'failed',
                errorMessage: 'Max attempts exceeded',
                meta: { codeId: activeCode.id, attempts: activeCode.attempt_count },
                ip,
            })
            return NextResponse.json(
                { error: 'Too many attempts. Please request a new code.' },
                { status: 429 },
            )
        }

        await incrementAttemptCount(admin, activeCode.id, activeCode.attempt_count)

        const inputHash = hashOtp(code)
        if (inputHash !== activeCode.code_hash) {
            const remaining = activeCode.max_attempts - (activeCode.attempt_count + 1)
            await logNotificationEvent(admin, {
                eventType: 'password_reset_otp_verify_failed',
                email,
                phone: activeCode.phone_normalized,
                userId: activeCode.user_id,
                status: 'failed',
                errorMessage: 'Invalid code',
                meta: { codeId: activeCode.id, remaining },
                ip,
            })
            return NextResponse.json(
                {
                    error: 'Invalid code. Please try again.',
                    attemptsRemaining: remaining,
                },
                { status: 400 },
            )
        }

        const resetToken = await markCodeVerified(admin, activeCode.id)

        await logNotificationEvent(admin, {
            eventType: 'password_reset_otp_verified',
            email,
            phone: activeCode.phone_normalized,
            userId: activeCode.user_id,
            status: 'verified',
            meta: { codeId: activeCode.id },
            ip,
        })

        return NextResponse.json({
            message: 'Code verified successfully.',
            resetToken,
        })
    } catch (err: any) {
        console.error('Password reset verify error:', err)
        return NextResponse.json(
            { error: 'Something went wrong. Please try again later.' },
            { status: 500 },
        )
    }
}
