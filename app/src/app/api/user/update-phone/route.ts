import { NextResponse } from 'next/server'

/**
 * Retired (Identity Foundation Stage 1). It changed public.users.phone from
 * a request-supplied userId without updating the login identity or verifying
 * the number, and had no callers. Phone changes go through
 * /api/user/update-profile (own account, login identity kept in step); the
 * database rejects API-role writes to identity fields.
 */
export async function POST() {
    return NextResponse.json(
        { success: false, error: 'This endpoint has been retired. Update your phone from your profile.' },
        { status: 410 },
    )
}
