import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhoneE164 } from '@/utils/phone'
import {
    findActiveCode,
    hashOtp,
    incrementAttemptCount,
    logNotificationEvent,
    markCodeVerified,
} from '@/server/auth/registrationVerificationService'
import { SHOP_CONTACT_VERIFICATION_PURPOSE } from '@/server/auth/shopContactVerificationService'

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const phoneRaw = String(body?.phone || '').trim()
        const code = String(body?.code || '').trim()

        if (!phoneRaw || !/^\d{4}$/.test(code)) {
            return NextResponse.json({ success: false, error: 'Please enter the 4-digit verification code.' }, { status: 400 })
        }

        const admin = createAdminClient()
        const phone = normalizePhoneE164(phoneRaw)
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null

        const activeCode = await findActiveCode(admin, phone, {
            purpose: SHOP_CONTACT_VERIFICATION_PURPOSE,
        })

        if (!activeCode) {
            await logNotificationEvent(admin, {
                eventType: 'shop_contact_otp_verify_failed',
                phone,
                status: 'failed',
                errorMessage: 'No active shop contact code found',
                ip,
            })

            return NextResponse.json({ success: false, error: 'The verification code has expired. Please request a new code.' }, { status: 400 })
        }

        if (activeCode.attempt_count >= activeCode.max_attempts) {
            await logNotificationEvent(admin, {
                eventType: 'shop_contact_otp_verify_failed',
                phone,
                status: 'failed',
                errorMessage: 'Maximum verification attempts exceeded',
                meta: { codeId: activeCode.id, attempts: activeCode.attempt_count },
                ip,
            })

            return NextResponse.json({ success: false, error: 'Too many incorrect attempts. Please request a new code.' }, { status: 429 })
        }

        await incrementAttemptCount(admin, activeCode.id, activeCode.attempt_count)

        if (hashOtp(code) !== activeCode.code_hash) {
            const remaining = activeCode.max_attempts - (activeCode.attempt_count + 1)

            await logNotificationEvent(admin, {
                eventType: 'shop_contact_otp_verify_failed',
                phone,
                status: 'failed',
                errorMessage: 'Invalid verification code',
                meta: { codeId: activeCode.id, remaining },
                ip,
            })

            return NextResponse.json({
                success: false,
                error: 'The verification code is incorrect. Please try again.',
                attemptsRemaining: remaining,
            }, { status: 400 })
        }

        const verificationToken = await markCodeVerified(admin, activeCode.id)

        await logNotificationEvent(admin, {
            eventType: 'shop_contact_otp_verified',
            phone,
            status: 'verified',
            meta: {
                codeId: activeCode.id,
                shop_name: activeCode.meta?.shop_request?.shopName || null,
            },
            ip,
        })

        return NextResponse.json({
            success: true,
            message: 'Shop contact mobile number verified successfully.',
            verificationToken,
        })
    } catch (error) {
        console.error('Shop contact OTP verify error:', error)
        return NextResponse.json(
            { success: false, error: 'Unable to verify the code right now. Please try again later.' },
            { status: 500 },
        )
    }
}