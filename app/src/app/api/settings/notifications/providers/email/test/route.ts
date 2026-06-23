import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type EmailTestRequest = {
  action: 'connection' | 'test-email'
  to?: string
  config?: Record<string, unknown>
  credentials?: { password?: string }
}

const asString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json() as EmailTestRequest
    const config = body.config || {}
    const host = asString(config.smtp_host)
    const username = asString(config.username)
    const password = asString(body.credentials?.password)
    const fromEmail = asString(config.from_email)
    const fromName = asString(config.from_name) || 'Serapod2U'
    const replyTo = asString(config.reply_to)
    const security = asString(config.security) || 'starttls'
    const port = Number(config.port || (security === 'ssl' ? 465 : 587))

    if (!host || !username || !password || !fromEmail || !Number.isInteger(port)) {
      return NextResponse.json({ error: 'SMTP host, port, username, password, and from email are required.' }, { status: 400 })
    }

    if (body.action === 'test-email' && (!body.to || !/^\S+@\S+\.\S+$/.test(body.to))) {
      return NextResponse.json({ error: 'Enter a valid test recipient email address.' }, { status: 400 })
    }

    const nodemailer = require('nodemailer')
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: security === 'ssl',
      requireTLS: security === 'starttls',
      auth: { user: username, pass: password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000
    })

    await transporter.verify()

    if (body.action === 'test-email') {
      const info = await transporter.sendMail({
        from: { name: fromName, address: fromEmail },
        to: body.to,
        replyTo: replyTo || undefined,
        subject: 'Serapod2U email delivery test',
        text: 'This test confirms that your Serapod2U SMTP provider can send notification email.'
      })
      return NextResponse.json({ success: true, messageId: info.messageId })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('SMTP provider test failed:', error)
    return NextResponse.json({ error: error?.message || 'SMTP provider test failed' }, { status: 500 })
  }
}
