import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveSmtpEndpoint, SmtpEndpointError } from '@/lib/email/smtp-endpoint'

export const dynamic = 'force-dynamic'

type EmailTestRequest = {
  action: 'connection' | 'test-email'
  to?: string
  config?: Record<string, unknown>
  credentials?: { password?: string }
}

const asString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const safeErrorCode = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

export async function POST(request: NextRequest) {
  let attemptedHost = ''
  let connectHost = ''
  let tlsServername = ''
  let attemptedPort: number | undefined
  let resolvedAddresses: string[] = []

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
    const security = (asString(config.security) || 'starttls').toLowerCase()
    const port = Number(config.port || (security === 'ssl' ? 465 : 587))
    attemptedHost = host
    attemptedPort = port

    if (!host || !username || !password || !fromEmail || !Number.isInteger(port) || port < 1 || port > 65_535) {
      return NextResponse.json({
        error: 'SMTP host, valid port, username, password, and from email are required.',
        attemptedHost,
        attemptedPort,
        resolvedAddresses
      }, { status: 400 })
    }

    if (!['starttls', 'ssl', 'none'].includes(security)) {
      return NextResponse.json({
        error: 'SMTP security must be STARTTLS, SSL/TLS, or None.',
        attemptedHost,
        attemptedPort,
        resolvedAddresses
      }, { status: 400 })
    }

    if (body.action === 'test-email' && (!body.to || !/^\S+@\S+\.\S+$/.test(body.to))) {
      return NextResponse.json({ error: 'Enter a valid test recipient email address.' }, { status: 400 })
    }

    const endpoint = await resolveSmtpEndpoint(host)
    connectHost = endpoint.connectHost
    tlsServername = endpoint.tlsServername
    resolvedAddresses = endpoint.resolvedAddresses

    const nodemailer = require('nodemailer')
    const transporter = nodemailer.createTransport({
      host: connectHost,
      port,
      secure: security === 'ssl',
      requireTLS: security === 'starttls',
      tls: { servername: tlsServername },
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
      return NextResponse.json({
        success: true,
        messageId: info.messageId,
        smtp_host: attemptedHost,
        connect_host: connectHost,
        port: attemptedPort,
        tls_servername: tlsServername,
        resolvedAddresses
      })
    }

    return NextResponse.json({
      success: true,
      smtp_host: attemptedHost,
      connect_host: connectHost,
      port: attemptedPort,
      tls_servername: tlsServername,
      resolvedAddresses
    })
  } catch (error: unknown) {
    if (error instanceof SmtpEndpointError) {
      connectHost = error.endpoint.connectHost
      tlsServername = error.endpoint.tlsServername
      resolvedAddresses = error.endpoint.resolvedAddresses
    }
    const code = safeErrorCode(error)
    const errorMessage = error instanceof Error ? error.message : 'SMTP provider test failed'
    console.error('SMTP provider test failed', {
      smtpHost: attemptedHost,
      connectHost,
      port: attemptedPort,
      tlsServername,
      resolvedAddresses,
      code,
      message: errorMessage
    })
    return NextResponse.json({
      error: errorMessage,
      smtp_host: attemptedHost,
      connect_host: connectHost,
      port: attemptedPort,
      tls_servername: tlsServername,
      resolvedAddresses,
      ...(code ? { code } : {})
    }, { status: error instanceof SmtpEndpointError ? 422 : 500 })
  }
}
