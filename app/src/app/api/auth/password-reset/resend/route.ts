/**
 * POST /api/auth/password-reset/resend
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
            isResend: true,
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
        console.error('Password reset resend error:', err)
        return NextResponse.json(
            { error: 'Something went wrong. Please try again later.' },
            { status: 500 },
        )
    }
}
