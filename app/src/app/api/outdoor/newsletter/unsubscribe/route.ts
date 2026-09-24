import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/** POST /api/outdoor/newsletter/unsubscribe — stop Outdoor product emails for this link. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const token = String(body.token || '').trim()
    if (!token || token.length > 80) {
      return NextResponse.json({ error: 'This unsubscribe link is not valid.' }, { status: 400 })
    }

    const admin: any = createAdminClient()
    const { data, error } = await admin
      .from('outdoor_newsletter_subscribers')
      .update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
      .eq('unsubscribe_token', token)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[outdoor/newsletter/unsubscribe]', error)
      return NextResponse.json({ error: 'Could not unsubscribe.' }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: 'This unsubscribe link is not valid.' }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[outdoor/newsletter/unsubscribe]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
