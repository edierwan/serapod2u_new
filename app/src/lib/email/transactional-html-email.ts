import { createHash, createHmac } from 'node:crypto'
import { resolveSmtpEndpoint } from '@/lib/email/smtp-endpoint'

type EmailResult = { success: boolean; notConfigured?: boolean; error?: string; providerName?: string }

function secrets(value: unknown): Record<string, any> {
    if (!value) return {}
    if (typeof value === 'object') return value as Record<string, any>
    try { return JSON.parse(String(value)) } catch { return {} }
}

function hmac(key: Buffer | string, value: string) {
    return createHmac('sha256', key).update(value).digest()
}

async function sendSes(config: any, secret: any, fromEmail: string, to: string, subject: string, text: string, html: string) {
    const region = config.aws_region || 'us-east-1'
    const host = `email.${region}.amazonaws.com`
    const payload = JSON.stringify({
        FromEmailAddress: fromEmail,
        Destination: { ToAddresses: [to] },
        Content: { Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Text: { Data: text, Charset: 'UTF-8' }, Html: { Data: html, Charset: 'UTF-8' } },
        } },
        ...(config.config_set ? { ConfigurationSetName: config.config_set } : {}),
    })
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = createHash('sha256').update(payload).digest('hex')
    const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = `POST\n/v2/email/outbound-emails\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
    const scope = `${dateStamp}/${region}/ses/aws4_request`
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash('sha256').update(canonicalRequest).digest('hex')}`
    const key = hmac(hmac(hmac(hmac(`AWS4${secret.aws_secret_access_key}`, dateStamp), region), 'ses'), 'aws4_request')
    const signature = createHmac('sha256', key).update(stringToSign).digest('hex')
    return fetch(`https://${host}/v2/email/outbound-emails`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', 'X-Amz-Date': amzDate, 'X-Amz-Content-Sha256': payloadHash,
            Authorization: `AWS4-HMAC-SHA256 Credential=${secret.aws_access_key_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
            ...(secret.aws_session_token ? { 'X-Amz-Security-Token': secret.aws_session_token } : {}),
        },
        body: payload,
    })
}

export async function sendTransactionalHtmlEmail(
    admin: any,
    orgId: string,
    input: { to: string; subject: string; text: string; html: string; fromName?: string },
): Promise<EmailResult> {
    const { data: provider } = await admin.from('notification_provider_configs').select('*')
        .eq('org_id', orgId).eq('channel', 'email').eq('is_active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!provider) return { success: false, notConfigured: true, error: 'No active email provider configured' }

    const config = provider.config_public || {}
    const secret = secrets(provider.config_encrypted)
    const fromEmail = config.from_email || config.gmail_email
    const fromName = input.fromName || config.from_name || 'Serapod2U'
    const message = { to: input.to, subject: input.subject, text: input.text, html: input.html }
    try {
        if (provider.provider_name === 'smtp' || provider.provider_name === 'gmail') {
            const nodemailer = require('nodemailer')
            let transporter: any
            if (provider.provider_name === 'smtp') {
                const endpoint = await resolveSmtpEndpoint(String(config.smtp_host || '').trim())
                const security = String(config.security || 'starttls').toLowerCase()
                transporter = nodemailer.createTransport({
                    host: endpoint.connectHost, port: Number(config.port || 587), secure: security === 'ssl',
                    requireTLS: security === 'starttls', tls: { servername: endpoint.tlsServername },
                    auth: { user: config.username || secret.username, pass: secret.password },
                })
            } else {
                const params = new URLSearchParams({
                    client_id: config.oauth_client_id,
                    client_secret: secret.oauth_client_secret || config.oauth_client_secret,
                    refresh_token: secret.oauth_refresh_token || config.oauth_refresh_token,
                    grant_type: 'refresh_token',
                })
                const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params,
                })
                const token = await tokenResponse.json()
                if (!tokenResponse.ok || !token.access_token) throw new Error('Unable to refresh Gmail access token')
                transporter = nodemailer.createTransport({
                    service: 'gmail', auth: { type: 'OAuth2', user: config.gmail_email,
                        clientId: config.oauth_client_id, clientSecret: secret.oauth_client_secret,
                        refreshToken: secret.oauth_refresh_token, accessToken: token.access_token },
                })
            }
            await transporter.sendMail({ from: `"${fromName}" <${fromEmail}>`, ...message })
            return { success: true, providerName: provider.provider_name }
        }

        let response: Response
        if (provider.provider_name === 'aws_ses') {
            response = await sendSes(config, secret, fromEmail, input.to, input.subject, input.text, input.html)
        } else if (provider.provider_name === 'sendgrid') {
            response = await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST', headers: { Authorization: `Bearer ${secret.api_key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ personalizations: [{ to: [{ email: input.to }] }], from: { email: fromEmail, name: fromName },
                    subject: input.subject, content: [{ type: 'text/plain', value: input.text }, { type: 'text/html', value: input.html }] }),
            })
        } else if (provider.provider_name === 'resend') {
            response = await fetch('https://api.resend.com/emails', {
                method: 'POST', headers: { Authorization: `Bearer ${secret.api_key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [input.to], subject: input.subject, text: input.text, html: input.html }),
            })
        } else if (provider.provider_name === 'postmark') {
            response = await fetch('https://api.postmarkapp.com/email', {
                method: 'POST', headers: { 'X-Postmark-Server-Token': secret.api_token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ From: `${fromName} <${fromEmail}>`, To: input.to, Subject: input.subject, TextBody: input.text, HtmlBody: input.html }),
            })
        } else if (provider.provider_name === 'mailgun') {
            const host = config.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net'
            const form = new FormData()
            form.set('from', `${fromName} <${fromEmail}>`); form.set('to', input.to); form.set('subject', input.subject)
            form.set('text', input.text); form.set('html', input.html)
            response = await fetch(`https://${host}/v3/${config.domain}/messages`, {
                method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`api:${secret.api_key}`).toString('base64')}` }, body: form,
            })
        } else {
            return { success: false, error: 'Configured email provider is not supported', providerName: provider.provider_name }
        }
        if (!response.ok) return { success: false, error: `Provider returned HTTP ${response.status}`, providerName: provider.provider_name }
        return { success: true, providerName: provider.provider_name }
    } catch (error: any) {
        return { success: false, error: error?.message || 'Email delivery failed', providerName: provider.provider_name }
    }
}
