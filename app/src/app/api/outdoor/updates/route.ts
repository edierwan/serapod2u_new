import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import { countOutdoorSubscribers, emailOutdoorSubscribers } from '@/lib/outdoor/notify-subscribers'

const KINDS = ['product', 'color', 'event', 'other'] as const

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]!))
}

const KIND_LABEL: Record<string, string> = {
  product: 'New product',
  color: 'New color',
  event: 'Event',
  other: 'Update',
}

/** GET — recent Outdoor updates for staff. */
export async function GET() {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin: any = createAdminClient()
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

/** POST — staff publishes an update and emails every newsletter subscriber. */
export async function POST(request: NextRequest) {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const kind = String(body.kind || '')
    const title = String(body.title || '').trim().slice(0, 140)
    const text = String(body.body || '').trim().slice(0, 4000)
    if (!KINDS.includes(kind as typeof KINDS[number]) || !title || text.length < 2) {
      return NextResponse.json({ error: 'Choose a type, title, and message.' }, { status: 400 })
    }

    const admin: any = createAdminClient()
    const { data: created, error: insertError } = await admin.from('outdoor_admin_updates').insert({
      kind,
      title,
      body: text,
      created_by: staff.userId,
      emailed_count: 0,
    }).select('id').single()

    if (insertError || !created) {
      console.error('[outdoor/updates] insert', insertError)
      return NextResponse.json({ error: 'Could not save the update. Apply the outdoor admin updates table first.' }, { status: 500 })
    }

    const label = KIND_LABEL[kind] || 'Update'
    const mailed = await emailOutdoorSubscribers(admin, {
      subject: `SeraOutdoor: ${title}`,
      text: `${label}\n\n${text}`,
      html: `<p><strong>${escapeHtml(label)}</strong></p><p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`,
    })
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
