import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendOutdoorSignupCode } from '@/lib/outdoor/signup-code'

/** POST /api/outdoor/register/request-code — email a 4-digit code before the account exists. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const admin = createAdminClient()
    const result = await sendOutdoorSignupCode(
      admin,
      String(body.email || ''),
      String(body.fullName || ''),
    )
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[outdoor/register/request-code]', err)
    return NextResponse.json({ error: 'Could not send the code.' }, { status: 500 })
  }
}
