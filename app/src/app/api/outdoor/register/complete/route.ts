import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { completeOutdoorSignup } from '@/lib/outdoor/signup-code'

/** POST /api/outdoor/register/complete — create the account only after the email code matches. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const admin = createAdminClient()
    const result = await completeOutdoorSignup(admin, {
      email: String(body.email || ''),
      code: String(body.code || ''),
      password: String(body.password || ''),
      fullName: String(body.fullName || ''),
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[outdoor/register/complete]', err)
    return NextResponse.json({ error: 'Could not create the account.' }, { status: 500 })
  }
}
