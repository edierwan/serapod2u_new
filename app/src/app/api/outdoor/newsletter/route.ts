import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildOutdoorWelcomeEmail } from '@/lib/outdoor/product-email'
import {
  outdoorUnsubscribeUrl,
  sendOutdoorSubscriberEmail,
  stampOutdoorUnsubscribe,
} from '@/lib/outdoor/notify-subscribers'

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function missingUnsubscribeColumns(message: string) {
  return /status|unsubscribe_token|welcomed_at|unsubscribed_at/i.test(message)
}

async function sendWelcome(admin: any, email: string, token: string) {
  const welcome = buildOutdoorWelcomeEmail()
  const stamped = stampOutdoorUnsubscribe(welcome.html, welcome.text, outdoorUnsubscribeUrl(token))
  const sent = await sendOutdoorSubscriberEmail(admin, email, {
    subject: welcome.subject,
    text: stamped.text,
    html: stamped.html,
  })
  if (!sent.success) {
    console.error('[outdoor/newsletter] welcome failed:', sent.error)
    return false
  }
  await admin
    .from('outdoor_newsletter_subscribers')
    .update({ welcomed_at: new Date().toISOString() })
    .eq('email_normalized', email)
  return true
}

/** POST /api/outdoor/newsletter — subscribe email. One welcome, no repeat mail. */
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
    const existing = await admin
      .from('outdoor_newsletter_subscribers')
      .select('id, status, unsubscribe_token')
      .eq('email_normalized', email)
      .maybeSingle()

    if (existing.error && missingUnsubscribeColumns(existing.error.message || '')) {
      const { error } = await admin.from('outdoor_newsletter_subscribers').upsert(
        { email: emailRaw, email_normalized: email, source },
        { onConflict: 'email_normalized', ignoreDuplicates: true },
      )
      if (error) {
        console.error('[outdoor/newsletter]', error)
        return NextResponse.json({ error: 'Could not save subscription.' }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    if (existing.error) {
      console.error('[outdoor/newsletter]', existing.error)
      return NextResponse.json({ error: 'Could not save subscription.' }, { status: 500 })
    }

    if (existing.data && existing.data.status !== 'unsubscribed') {
      return NextResponse.json({ ok: true, already: true })
    }

    const token = String(existing.data?.unsubscribe_token || '').trim() || crypto.randomUUID()
    if (!existing.data) {
      const { error } = await admin.from('outdoor_newsletter_subscribers').insert({
        email: emailRaw,
        email_normalized: email,
        source,
        status: 'active',
        unsubscribe_token: token,
      })
      if (error) {
        if (/duplicate|unique/i.test(error.message || '')) {
          return NextResponse.json({ ok: true, already: true })
        }
        console.error('[outdoor/newsletter]', error)
        return NextResponse.json({ error: 'Could not save subscription.' }, { status: 500 })
      }
    } else {
      const { error } = await admin
        .from('outdoor_newsletter_subscribers')
        .update({
          email: emailRaw,
          source,
          status: 'active',
          unsubscribed_at: null,
          unsubscribe_token: token,
        })
        .eq('id', existing.data.id)
      if (error) {
        console.error('[outdoor/newsletter]', error)
        return NextResponse.json({ error: 'Could not save subscription.' }, { status: 500 })
      }
    }

    const welcomed = await sendWelcome(admin, email, token)
    return NextResponse.json({ ok: true, welcomed })
  } catch (err) {
    console.error('[outdoor/newsletter]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
