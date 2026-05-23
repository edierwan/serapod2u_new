import { NextRequest, NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/supabase/admin'
import { startShopContactVerification } from '@/server/auth/shopContactVerificationService'

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const orgId = String(body?.orgId || '').trim()

        if (!orgId) {
            return NextResponse.json({ success: false, error: 'Organization is required.' }, { status: 400 })
        }

        const admin = createAdminClient()
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
        const userAgent = req.headers.get('user-agent') || null

        const result = await startShopContactVerification(admin, {
            form: body,
            orgId,
            confirmCreate: Boolean(body?.confirmCreate),
            resend: false,
            ip,
            userAgent,
        })

        return NextResponse.json(result.body, { status: result.status })
    } catch (error) {
        console.error('Shop contact OTP request error:', error)
        return NextResponse.json(
            { success: false, error: 'Unable to start shop contact verification right now. Please try again later.' },
            { status: 500 },
        )
    }
}