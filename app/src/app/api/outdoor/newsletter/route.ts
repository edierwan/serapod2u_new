import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

/** POST /api/outdoor/newsletter — subscribe email (idempotent). */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const emailRaw = String(body.email || '').trim()
    const email = normalizeEmail(emailRaw)
    const source = String(body.source || 'outdoor_home').slice(0, 80)

    if (!email || !email.includes('@') || email.length > 254) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 })
    }

    const admin: any = createAdminClient()
    const { error } = await admin.from('outdoor_newsletter_subscribers').upsert(
      {
        email: emailRaw,
        email_normalized: email,
        source,
      },
      { onConflict: 'email_normalized', ignoreDuplicates: true },
    )

    if (error) {
      console.error('[outdoor/newsletter]', error)
      return NextResponse.json({ error: 'Could not save subscription.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[outdoor/newsletter]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
