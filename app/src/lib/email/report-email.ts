/**
 * Server-side email delivery with PDF attachment support.
 *
 * Reuses the org's configured email provider from notification_provider_configs
 * (the same table the notification outbox worker uses) — no new provider setup,
 * and credentials never leave the server. The outbox worker's sender is
 * text-only, so report emails go through here to carry the PDF attachment.
 *
 * Supported providers: smtp, gmail (nodemailer attachments), sendgrid, resend,
 * postmark, mailgun (API attachments) and aws_ses (raw MIME).
 */
import { createHash, createHmac } from 'node:crypto'
import { resolveSmtpEndpoint } from '@/lib/email/smtp-endpoint'

type Admin = any

export interface ReportEmailAttachment {
    filename: string
    /** Base64-encoded file body (no data: prefix). */
    contentBase64: string
    contentType: string
}

export interface ReportEmailInput {
    to: string[]
    cc: string[]
    subject: string
    text: string
    attachment: ReportEmailAttachment
}

export interface ReportEmailResult {
    success: boolean
    messageId?: string | null
    providerName?: string | null
    /** Technical error detail — log it, never show it to the user. */
    error?: string
    /** True when no active email provider is configured for the org. */
    notConfigured?: boolean
}

function parseProviderSecrets(value: unknown): Record<string, any> {
    if (!value) return {}
    if (typeof value === 'object') return value as Record<string, any>
    try { return JSON.parse(String(value)) } catch { return {} }
}

function hmac(key: Buffer | string, value: string) {
    return createHmac('sha256', key).update(value).digest()
}

/** RFC 2045 base64 line wrapping for raw MIME bodies. */
function wrapBase64(b64: string): string {
    return b64.replace(/(.{76})/g, '$1\r\n')
}

/** Minimal multipart/mixed MIME message (text body + one attachment). */
function buildRawMime(
    from: string,
    input: ReportEmailInput,
): string {
    const boundary = `----=_serapod_${Date.now().toString(36)}`
    const lines = [
        `From: ${from}`,
        `To: ${input.to.join(', ')}`,
        ...(input.cc.length > 0 ? [`Cc: ${input.cc.join(', ')}`] : []),
        `Subject: ${input.subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        input.text,
        '',
        `--${boundary}`,
        `Content-Type: ${input.attachment.contentType}; name="${input.attachment.filename}"`,
        `Content-Disposition: attachment; filename="${input.attachment.filename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64(input.attachment.contentBase64),
        `--${boundary}--`,
        '',
    ]
    return lines.join('\r\n')
}

async function sendViaAwsSesRaw(
    publicConfig: Record<string, any>,
    secrets: Record<string, any>,
    fromEmail: string,
    fromName: string,
    input: ReportEmailInput,
): Promise<ReportEmailResult> {
    const region = publicConfig.aws_region || 'us-east-1'
    const host = `email.${region}.amazonaws.com`
    const raw = buildRawMime(`"${fromName}" <${fromEmail}>`, input)
    const payload = JSON.stringify({
        FromEmailAddress: fromEmail,
        Destination: { ToAddresses: input.to, ...(input.cc.length > 0 ? { CcAddresses: input.cc } : {}) },
        Content: { Raw: { Data: Buffer.from(raw).toString('base64') } },
        ...(publicConfig.config_set ? { ConfigurationSetName: publicConfig.config_set } : {}),
    })
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = createHash('sha256').update(payload).digest('hex')
    const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = `POST\n/v2/email/outbound-emails\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
    const credentialScope = `${dateStamp}/${region}/ses/aws4_request`
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${createHash('sha256').update(canonicalRequest).digest('hex')}`
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secrets.aws_secret_access_key}`, dateStamp), region), 'ses'), 'aws4_request')
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    const response = await fetch(`https://${host}/v2/email/outbound-emails`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Amz-Date': amzDate,
            'X-Amz-Content-Sha256': payloadHash,
            Authorization: `AWS4-HMAC-SHA256 Credential=${secrets.aws_access_key_id}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
            ...(secrets.aws_session_token ? { 'X-Amz-Security-Token': secrets.aws_session_token } : {}),
        },
        body: payload,
    })
    const responseBody = await response.text()
    if (!response.ok) return { success: false, error: `aws_ses returned ${response.status}: ${responseBody}` }
    try { return { success: true, messageId: JSON.parse(responseBody)?.MessageId || null } } catch { return { success: true, messageId: null } }
}

/**
 * Send an email with attachment via the org's active email provider.
 * Never throws — returns { success, error } so callers control the user-facing
 * message and log the technical detail server-side.
 */
export async function sendReportEmail(
    admin: Admin,
    orgId: string,
    input: ReportEmailInput,
): Promise<ReportEmailResult> {
    const { data: config } = await admin
        .from('notification_provider_configs')
        .select('*')
        .eq('org_id', orgId)
        .eq('channel', 'email')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (!config) return { success: false, notConfigured: true, error: 'No active email provider configured' }

    const publicConfig = config.config_public || {}
    const secrets = parseProviderSecrets(config.config_encrypted)
    const fromEmail = publicConfig.from_email || publicConfig.gmail_email
    const fromName = publicConfig.from_name || 'Serapod2U'
    const providerName = config.provider_name as string
    const attachmentBuffer = Buffer.from(input.attachment.contentBase64, 'base64')

    try {
        if (providerName === 'aws_ses') {
            const result = await sendViaAwsSesRaw(publicConfig, secrets, fromEmail, fromName, input)
            return { ...result, providerName }
        }

        if (providerName === 'smtp' || providerName === 'gmail') {
            const nodemailer = require('nodemailer')
            let transporter: any
            if (providerName === 'smtp') {
                const smtpHost = String(publicConfig.smtp_host || '').trim()
                const security = String(publicConfig.security || 'starttls').toLowerCase()
                const endpoint = await resolveSmtpEndpoint(smtpHost)
                transporter = nodemailer.createTransport({
                    host: endpoint.connectHost,
                    port: Number(publicConfig.port || 587),
                    secure: security === 'ssl',
                    requireTLS: security === 'starttls',
                    tls: { servername: endpoint.tlsServername },
                    auth: { user: publicConfig.username || secrets.username, pass: secrets.password },
                })
            } else {
                const params = new URLSearchParams({
                    client_id: publicConfig.oauth_client_id,
                    client_secret: secrets.oauth_client_secret || publicConfig.oauth_client_secret,
                    refresh_token: secrets.oauth_refresh_token || publicConfig.oauth_refresh_token,
                    grant_type: 'refresh_token',
                })
                const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: params,
                })
                const token = await tokenResponse.json()
                if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || 'Unable to refresh Gmail access token')
                transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        type: 'OAuth2',
                        user: publicConfig.gmail_email,
                        clientId: publicConfig.oauth_client_id,
                        clientSecret: secrets.oauth_client_secret,
                        refreshToken: secrets.oauth_refresh_token,
                        accessToken: token.access_token,
                    },
                })
            }
            const result = await transporter.sendMail({
                from: `"${fromName}" <${fromEmail}>`,
                to: input.to.join(', '),
                ...(input.cc.length > 0 ? { cc: input.cc.join(', ') } : {}),
                subject: input.subject,
                text: input.text,
                attachments: [{
                    filename: input.attachment.filename,
                    content: attachmentBuffer,
                    contentType: input.attachment.contentType,
                }],
            })
            return { success: true, messageId: result.messageId, providerName }
        }

        let response: Response
        if (providerName === 'sendgrid') {
            response = await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST',
                headers: { Authorization: `Bearer ${secrets.api_key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    personalizations: [{
                        to: input.to.map((email) => ({ email })),
                        ...(input.cc.length > 0 ? { cc: input.cc.map((email) => ({ email })) } : {}),
                    }],
                    from: { email: fromEmail, name: fromName },
                    subject: input.subject,
                    content: [{ type: 'text/plain', value: input.text }],
                    attachments: [{
                        content: input.attachment.contentBase64,
                        filename: input.attachment.filename,
                        type: input.attachment.contentType,
                        disposition: 'attachment',
                    }],
                }),
            })
        } else if (providerName === 'resend') {
            response = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { Authorization: `Bearer ${secrets.api_key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: `${fromName} <${fromEmail}>`,
                    to: input.to,
                    ...(input.cc.length > 0 ? { cc: input.cc } : {}),
                    subject: input.subject,
                    text: input.text,
                    attachments: [{ filename: input.attachment.filename, content: input.attachment.contentBase64 }],
                }),
            })
        } else if (providerName === 'postmark') {
            response = await fetch('https://api.postmarkapp.com/email', {
                method: 'POST',
                headers: { 'X-Postmark-Server-Token': secrets.api_token, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    From: `${fromName} <${fromEmail}>`,
                    To: input.to.join(', '),
                    ...(input.cc.length > 0 ? { Cc: input.cc.join(', ') } : {}),
                    Subject: input.subject,
                    TextBody: input.text,
                    Attachments: [{
                        Name: input.attachment.filename,
                        Content: input.attachment.contentBase64,
                        ContentType: input.attachment.contentType,
                    }],
                }),
            })
        } else if (providerName === 'mailgun') {
            const regionHost = publicConfig.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net'
            const form = new FormData()
            form.set('from', `${fromName} <${fromEmail}>`)
            for (const to of input.to) form.append('to', to)
            for (const cc of input.cc) form.append('cc', cc)
            form.set('subject', input.subject)
            form.set('text', input.text)
            form.append(
                'attachment',
                new Blob([new Uint8Array(attachmentBuffer)], { type: input.attachment.contentType }),
                input.attachment.filename,
            )
            response = await fetch(`https://${regionHost}/v3/${publicConfig.domain}/messages`, {
                method: 'POST',
                headers: { Authorization: `Basic ${Buffer.from(`api:${secrets.api_key}`).toString('base64')}` },
                body: form,
            })
        } else {
            return { success: false, providerName, error: `Email provider ${providerName} does not support report attachments` }
        }

        const responseBody = await response.text()
        if (!response.ok) return { success: false, providerName, error: `${providerName} returned ${response.status}: ${responseBody}` }
        let messageId: string | null = response.headers.get('x-message-id')
        try { messageId ||= JSON.parse(responseBody)?.id || JSON.parse(responseBody)?.MessageID || null } catch { }
        return { success: true, messageId, providerName }
    } catch (error: any) {
        return { success: false, providerName, error: error?.message || 'Email delivery failed' }
    }
}
