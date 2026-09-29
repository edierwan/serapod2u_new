import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import {
  countOutdoorSubscribers,
  emailOutdoorSubscribers,
  sendOutdoorSubscriberEmail,
  stampOutdoorUnsubscribe,
} from '@/lib/outdoor/notify-subscribers'
import { buildOutdoorUpdateEmail, outdoorPublicOrigin } from '@/lib/outdoor/product-email'
import {
  OUTDOOR_UPDATE_BODY_MAX,
  OUTDOOR_UPDATE_LEGACY_KINDS,
  OUTDOOR_UPDATE_TITLE_MAX,
  isOutdoorUpdateKind,
  outdoorUpdateLink,
} from '@/lib/outdoor/newsletter-updates'

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000

/** GET — recent Outdoor updates for staff; `?list=subscribers` returns the newsletter list. */
export async function GET(request: NextRequest) {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin: any = createAdminClient()

    if (request.nextUrl.searchParams.get('list') === 'subscribers') {
      const { data, error } = await admin
        .from('outdoor_newsletter_subscribers')
        .select('id, email, source, status, created_at, unsubscribed_at')
        .order('created_at', { ascending: false })
        .limit(1000)
      if (error) {
        console.error('[outdoor/updates GET subscribers]', error)
        return NextResponse.json({ error: 'Could not load subscribers.' }, { status: 500 })
      }
      return NextResponse.json({ subscribers: data || [] })
    }

    const [{ data, error }, subscribers] = await Promise.all([
      admin.from('outdoor_admin_updates').select('id, kind, title, body, emailed_count, created_at').order('created_at', { ascending: false }).limit(30),
      countOutdoorSubscribers(admin),
    ])

    if (error) {
      console.error('[outdoor/updates GET]', error)
      return NextResponse.json({ error: 'Could not load updates.' }, { status: 500 })
    }

    return NextResponse.json({ updates: data || [], subscribers })
  } catch (err) {
    console.error('[outdoor/updates GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST — staff publishes an update and emails every active newsletter subscriber.
 * `test: true` sends the same email only to the signed-in staff member and saves nothing.
 */
export async function POST(request: NextRequest) {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const kind = String(body.kind || '')
    const title = String(body.title || '').trim().slice(0, OUTDOOR_UPDATE_TITLE_MAX)
    const text = String(body.body || '').trim().slice(0, OUTDOOR_UPDATE_BODY_MAX)
    if (!isOutdoorUpdateKind(kind) || !title || text.length < 2) {
      return NextResponse.json({ error: 'Choose a type, title, and message.' }, { status: 400 })
    }
    const link = outdoorUpdateLink(String(body.link || ''), outdoorPublicOrigin())
    if (link.error !== undefined) return NextResponse.json({ error: link.error }, { status: 400 })

    const email = buildOutdoorUpdateEmail({ kind, title, body: text, link: link.url })
    const admin: any = createAdminClient()

    if (body.test === true) {
      const { data: me } = await admin.from('users').select('email').eq('id', staff.userId).maybeSingle()
      const to = String(me?.email || '').trim()
      if (!to.includes('@')) {
        return NextResponse.json({ error: 'Your account has no email address for the test.' }, { status: 400 })
      }
      const stamped = stampOutdoorUnsubscribe(email.html, email.text, '')
      const sent = await sendOutdoorSubscriberEmail(admin, to, {
        subject: `[Test] ${email.subject}`,
        text: stamped.text,
        html: stamped.html,
      })
      if (!sent.success) {
        return NextResponse.json({ error: sent.error || 'Could not send the test email.' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, test: true, to })
    }

    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString()
    const recent = await admin.from('outdoor_admin_updates').select('id').eq('title', title).gte('created_at', since).limit(1)
    if (!recent.error && Array.isArray(recent.data) && recent.data.length > 0) {
      return NextResponse.json({ error: 'An update with this title was sent a few minutes ago. Change the title if you really want to send it again.' }, { status: 409 })
    }

    const row = { kind, title, body: text, created_by: staff.userId, emailed_count: 0 }
    let saved = await admin.from('outdoor_admin_updates').insert(row).select('id').single()
    if (saved.error?.code === '23514' && !OUTDOOR_UPDATE_LEGACY_KINDS.includes(kind)) {
      saved = await admin.from('outdoor_admin_updates').insert({ ...row, kind: 'other' }).select('id').single()
    }
    const created = saved.data

    if (saved.error || !created) {
      console.error('[outdoor/updates] insert', saved.error)
      return NextResponse.json({ error: 'Could not save the update. Apply the outdoor admin updates table first.' }, { status: 500 })
    }

    const mailed = await emailOutdoorSubscribers(admin, email)
    if (!mailed.ok) {
      return NextResponse.json({ error: mailed.error }, { status: 500 })
    }

    await admin.from('outdoor_admin_updates').update({ emailed_count: mailed.emailed }).eq('id', created.id)

    return NextResponse.json({ ok: true, emailed: mailed.emailed, subscribers: mailed.subscribers })
  } catch (err) {
    console.error('[outdoor/updates POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
