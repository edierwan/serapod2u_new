import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import { sendTransactionalHtmlEmail } from '@/lib/email/transactional-html-email'
import { resolveOrgForEmail } from '@/server/auth/passwordResetService'

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
    const [{ data, error }, { count }] = await Promise.all([
      admin.from('outdoor_admin_updates').select('id, kind, title, body, emailed_count, created_at').order('created_at', { ascending: false }).limit(30),
      admin.from('outdoor_newsletter_subscribers').select('id', { count: 'exact', head: true }),
    ])

    if (error) {
      console.error('[outdoor/updates GET]', error)
      return NextResponse.json({ error: 'Could not load updates.' }, { status: 500 })
    }

    return NextResponse.json({ updates: data || [], subscribers: count || 0 })
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
    const { data: subscribers, error: listError } = await admin
      .from('outdoor_newsletter_subscribers')
      .select('email_normalized')
      .limit(500)

    if (listError) {
      console.error('[outdoor/updates] subscribers', listError)
      return NextResponse.json({ error: 'Could not load subscribers.' }, { status: 500 })
    }

    const orgId = await resolveOrgForEmail(admin)
    if (!orgId) {
      return NextResponse.json({ error: 'Email is not configured.' }, { status: 500 })
    }

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
    const subject = `SeraOutdoor: ${title}`
    const html = `<p><strong>${escapeHtml(label)}</strong></p><p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`
    let emailed = 0
    for (const row of subscribers || []) {
      const to = String(row.email_normalized || '').trim()
      if (!to.includes('@')) continue
      const sent = await sendTransactionalHtmlEmail(admin, orgId, {
        to,
        subject,
        text: `${label}\n\n${text}`,
        html,
        fromName: 'SeraOutdoor',
      })
      if (sent.success) emailed += 1
    }

    await admin.from('outdoor_admin_updates').update({ emailed_count: emailed }).eq('id', created.id)

    return NextResponse.json({ ok: true, emailed, subscribers: (subscribers || []).length })
  } catch (err) {
    console.error('[outdoor/updates POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
