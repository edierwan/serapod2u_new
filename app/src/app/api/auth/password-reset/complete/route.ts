/**
 * POST /api/auth/password-reset/complete
 *
 * Set new password using the reset token issued after OTP verification.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
    findCodeByResetToken,
    identifierMatchesCodeRow,
    logNotificationEvent,
    markCodeUsed,
    parsePasswordResetIdentifier,
    resolvePasswordResetChannel,
} from '@/server/auth/passwordResetService'

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const identifierRaw = typeof body?.identifier === 'string'
            ? body.identifier
            : typeof body?.email === 'string'
                ? body.email
                : ''
        const resetToken: string | undefined = body?.resetToken
        const newPassword: string | undefined = body?.newPassword
        const confirmPassword: string | undefined = body?.confirmPassword

        if (!identifierRaw || !resetToken || !newPassword || !confirmPassword) {
            return NextResponse.json(
                { error: 'All fields are required.' },
                { status: 400 },
            )
        }

        const identifier = parsePasswordResetIdentifier(identifierRaw)
        if (!identifier) {
            return NextResponse.json(
                { error: 'Please enter a valid email address or phone number.' },
                { status: 400 },
            )
        }

        const channel = resolvePasswordResetChannel(identifier, body?.delivery)

        if (newPassword !== confirmPassword) {
            return NextResponse.json(
                { error: 'Passwords do not match.' },
                { status: 400 },
            )
        }

        if (newPassword.length < 6) {
            return NextResponse.json(
                { error: 'Password must be at least 6 characters.' },
                { status: 400 },
            )
        }

        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
        const admin = createAdminClient()
        const lookupEmail = identifier.kind === 'email' ? identifier.value : ''

        const codeRow = await findCodeByResetToken(admin, resetToken)
        if (!codeRow) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_complete_failed',
                email: lookupEmail,
                status: 'failed',
                errorMessage: 'Invalid or expired reset token',
                channel,
                ip,
            })
            return NextResponse.json(
                { error: 'Reset session expired. Please start over.' },
                { status: 400 },
            )
        }

        if (!identifierMatchesCodeRow(identifier, codeRow)) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_complete_failed',
                email: lookupEmail,
                phone: codeRow.phone_normalized,
                userId: codeRow.user_id,
                status: 'failed',
                errorMessage: 'Identifier mismatch with reset token',
                channel,
                ip,
            })
            return NextResponse.json(
                { error: 'Reset session expired. Please start over.' },
                { status: 400 },
            )
        }

        if (!codeRow.verified_at) {
            return NextResponse.json(
                { error: 'Reset session expired. Please start over.' },
                { status: 400 },
            )
        }

        if (!codeRow.user_id) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_complete_failed',
                email: codeRow.email_normalized || lookupEmail,
                status: 'failed',
                errorMessage: 'No user_id associated with verification code',
                channel,
                ip,
            })
            return NextResponse.json(
                { error: 'Unable to reset password. Please contact support.' },
                { status: 500 },
            )
        }

        const { error: updateError } = await admin.auth.admin.updateUserById(
            codeRow.user_id,
            { password: newPassword },
        )

        if (updateError) {
            await logNotificationEvent(admin, {
                eventType: 'password_reset_complete_failed',
                email: codeRow.email_normalized || lookupEmail,
                phone: codeRow.phone_normalized,
                userId: codeRow.user_id,
                status: 'failed',
                errorMessage: updateError.message,
                channel,
                ip,
            })
            return NextResponse.json(
                { error: 'Failed to update password. Please try again.' },
                { status: 500 },
            )
        }

        await markCodeUsed(admin, codeRow.id)

        await logNotificationEvent(admin, {
            eventType: 'password_reset_password_updated',
            email: codeRow.email_normalized || lookupEmail,
            phone: codeRow.phone_normalized,
            userId: codeRow.user_id,
            status: 'completed',
            meta: { codeId: codeRow.id },
            channel,
            ip,
        })

        return NextResponse.json({
            message: 'Password updated successfully. Please log in to continue.',
        })
    } catch (err: any) {
        console.error('Password reset complete error:', err)
        return NextResponse.json(
            { error: 'Something went wrong. Please try again later.' },
            { status: 500 },
        )
    }
}
