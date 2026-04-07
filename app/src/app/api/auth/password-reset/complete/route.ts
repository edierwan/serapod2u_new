/**
 * POST /api/auth/password-reset/complete
 *
 * Step D: Set new password. Requires the reset token issued in Step C.
 * Updates password via Supabase Auth admin API, marks code used, logs event.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhoneE164 } from '@/utils/phone'
import {
    findCodeByResetToken,
    markCodeUsed,
    logNotificationEvent,
} from '@/server/auth/passwordResetService'

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const phoneRaw: string | undefined = body?.phone
        const resetToken: string | undefined = body?.resetToken
        const newPassword: string | undefined = body?.newPassword
        const confirmPassword: string | undefined = body?.confirmPassword

        // ── Input validation ──────────────────────────────────────────────
        if (!phoneRaw || !resetToken || !newPassword || !confirmPassword) {
            return NextResponse.json(
                { error: 'All fields are required.' },
                { status: 400 }
            )
        }

        if (newPassword !== confirmPassword) {
            return NextResponse.json(
                { error: 'Passwords do not match.' },
                { status: 400 }
            )
        }

        if (newPassword.length < 6) {
            return NextResponse.json(
                { error: 'Password must be at least 6 characters.' },
                { status: 400 }
            )
        }

        const phone = normalizePhoneE164(phoneRaw.trim())
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
        const admin = createAdminClient()

        // ── Validate reset token ──────────────────────────────────────────
        const codeRow = await findCodeByResetToken(admin, resetToken)
        if (!codeRow) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_complete_failed',
                phone,
                status: 'failed',
                errorMessage: 'Invalid or expired reset token',
                ip,
            })
            return NextResponse.json(
                { error: 'Reset session expired. Please start over.' },
                { status: 400 }
            )
        }

        // Verify the phone matches the code row
        if (codeRow.phone_normalized !== phone) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_complete_failed',
                phone,
                userId: codeRow.user_id,
                status: 'failed',
                errorMessage: 'Phone mismatch with reset token',
                ip,
            })
            return NextResponse.json(
                { error: 'Reset session expired. Please start over.' },
                { status: 400 }
            )
        }

        // Code must have been verified
        if (!codeRow.verified_at) {
            return NextResponse.json(
                { error: 'Reset session expired. Please start over.' },
                { status: 400 }
            )
        }

        // ── Update password via Supabase Auth Admin API ───────────────────
        if (!codeRow.user_id) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_complete_failed',
                phone,
                status: 'failed',
                errorMessage: 'No user_id associated with verification code',
                ip,
            })
            return NextResponse.json(
                { error: 'Unable to reset password. Please contact support.' },
                { status: 500 }
            )
        }

        const { error: updateError } = await admin.auth.admin.updateUserById(
            codeRow.user_id,
            { password: newPassword }
        )

        if (updateError) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_complete_failed',
                phone,
                userId: codeRow.user_id,
                status: 'failed',
                errorMessage: updateError.message,
                ip,
            })
            return NextResponse.json(
                { error: 'Failed to update password. Please try again.' },
                { status: 500 }
            )
        }

        // ── Mark code as used ─────────────────────────────────────────────
        await markCodeUsed(admin, codeRow.id)

        // ── Log success ───────────────────────────────────────────────────
        await logNotificationEvent(admin, {
            eventType: 'password_reset_password_updated',
            phone,
            userId: codeRow.user_id,
            status: 'completed',
            meta: { codeId: codeRow.id },
            ip,
        })

        return NextResponse.json({
            message: 'Password updated successfully. Please log in to continue.',
        })
    } catch (err: any) {
        console.error('Password reset complete error:', err)
        return NextResponse.json(
            { error: 'Something went wrong. Please try again later.' },
            { status: 500 }
        )
    }
}
