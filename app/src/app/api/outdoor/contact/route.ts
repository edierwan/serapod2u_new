import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import { sendTransactionalHtmlEmail } from '@/lib/email/transactional-html-email'
import { resolveOrgForEmail } from '@/server/auth/passwordResetService'

const OUTDOOR_CONTACT_INBOX = 'outdoor@serapod.com'

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]!))
}

/** POST /api/outdoor/contact — store contact form message. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const name = String(body.name || '').trim().slice(0, 120)
    const email = String(body.email || '').trim().slice(0, 254)
    const message = String(body.message || '').trim().slice(0, 4000)

    if (!name || !email.includes('@') || message.length < 5) {
      return NextResponse.json({ error: 'Name, email, and message are required.' }, { status: 400 })
    }

    const admin: any = createAdminClient()
    const { error } = await admin.from('outdoor_contact_messages').insert({
      name,
      email,
      message,
      status: 'new',
    })

    if (error) {
      console.error('[outdoor/contact]', error)
      return NextResponse.json({ error: 'Could not send message.' }, { status: 500 })
    }

    const orgId = await resolveOrgForEmail(admin)
    if (!orgId) {
      return NextResponse.json({ error: 'Could not send message.' }, { status: 500 })
    }

    const subject = `Outdoor contact from ${name}`
    const text = [
      `Name: ${name}`,
      `Email: ${email}`,
      '',
      message,
    ].join('\n')
    const html = `<p><strong>Name:</strong> ${escapeHtml(name)}<br><strong>Email:</strong> ${escapeHtml(email)}</p><p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
    const sent = await sendTransactionalHtmlEmail(admin, orgId, {
      to: OUTDOOR_CONTACT_INBOX,
      subject,
      text,
      html,
      fromName: 'SeraOutdoor',
    })
    if (!sent.success) {
      console.error('[outdoor/contact] email failed:', sent.error)
      return NextResponse.json({ error: 'Could not send message.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[outdoor/contact]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** GET — recent Outdoor contact messages for HQ staff. */
export async function GET(request: NextRequest) {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 30), 100)
    const admin: any = createAdminClient()
    const { data, error } = await admin
      .from('outdoor_contact_messages')
      .select('id, name, email, message, status, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[outdoor/contact GET]', error)
      return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
    }

    return NextResponse.json({ messages: data || [] })
  } catch (err) {
    console.error('[outdoor/contact GET]', err)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
}
