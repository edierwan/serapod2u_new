/**
 * POST /api/auth/password-reset/request
 *
 * Collect Points: email OTP, generic success.
 * Portal: email → email OTP, phone → SMS OTP. Unregistered contacts are disclosed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
    isPortalPasswordReset,
    issuePasswordResetOtp,
} from '@/server/auth/passwordResetService'

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const identifierRaw = typeof body?.identifier === 'string'
            ? body.identifier
            : typeof body?.email === 'string'
                ? body.email
                : ''
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
        const ua = req.headers.get('user-agent') || null
        const admin = createAdminClient()

        const result = await issuePasswordResetOtp(admin, {
            identifierRaw,
            delivery: body?.delivery,
            disclose: isPortalPasswordReset(body?.mode) || body?.disclose === true,
            ip,
            ua,
        })

        if (!result.ok) {
            return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
        }

        return NextResponse.json({
            message: result.message,
            resendCooldown: result.resendCooldown,
            channel: result.channel,
        })
    } catch (err: any) {
        console.error('Password reset request error:', err)
        return NextResponse.json(
            { error: 'Something went wrong. Please try again later.' },
            { status: 500 },
        )
    }
}
