import { NextRequest, NextResponse } from 'next/server'
import { createHash, createHmac } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { getWhatsAppConfig, callGateway, sendWhatsAppMessage } from '@/app/api/settings/whatsapp/_utils'
import { expandNotificationRoleCodes } from '@/lib/notifications/recipientRoleCodes'

/**
 * CRON: /api/cron/notification-outbox-worker
 * Background worker to process queued notification outbox messages.
 * Picks up pending items from notifications_outbox, resolves recipients,
 * renders templates, and sends via WhatsApp/SMS/Email.
 * 
 * Runs every minute via internal cron scheduler or can be called manually.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Simple template renderer
function renderTemplate(template: string, payload: Record<string, any>): string {
    let result = template
    for (const [key, value] of Object.entries(payload)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value ?? ''))
    }
    return result
}

function splitConfiguredRecipients(value?: string | null): string[] {
    return String(value || '')
        .split(/[\n,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
}

async function queueEmailFallback(
    supabase: any,
    item: any,
    recipientPhone: string | null,
    reason: string
) {
    const { data: setting } = await supabase
        .from('notification_settings')
        .select('recipient_config')
        .eq('org_id', item.org_id)
        .eq('event_code', item.event_code)
        .maybeSingle()

    if (setting?.recipient_config?.routing?.preset !== 'whatsapp_email_fallback') return false

    const { data: emailProvider } = await supabase
        .from('notification_provider_configs')
        .select('provider_name')
        .eq('org_id', item.org_id)
        .eq('channel', 'email')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (!emailProvider) return false

    const fallbackMarker = { _routing_fallback_for: item.id }
    const { data: existing } = await supabase
        .from('notifications_outbox')
        .select('id')
        .eq('org_id', item.org_id)
        .eq('channel', 'email')
        .contains('payload_json', fallbackMarker)
        .limit(1)

    if (existing?.length) return true

    let recipientEmail: string | null = null
    if (recipientPhone) {
        const { data: matchingUser } = await supabase
            .from('users')
            .select('email')
            .eq('organization_id', item.org_id)
            .eq('phone', recipientPhone)
            .maybeSingle()
        recipientEmail = matchingUser?.email || null
    }

    const payload = typeof item.payload_json === 'object' && item.payload_json !== null
        ? item.payload_json
        : {}
    const { error } = await supabase.from('notifications_outbox').insert({
        org_id: item.org_id,
        event_code: item.event_code,
        channel: 'email',
        to_phone: null,
        to_email: recipientEmail,
        template_code: item.template_code,
        payload_json: { ...payload, ...fallbackMarker, _routing_fallback_reason: reason },
        priority: item.priority || 'normal',
        provider_name: emailProvider.provider_name,
        status: 'queued',
        retry_count: 0,
        max_retries: 3,
    })

    return !error
}

function parseProviderSecrets(value: unknown): Record<string, any> {
    if (!value) return {}
    if (typeof value === 'object') return value as Record<string, any>
    try { return JSON.parse(String(value)) } catch { return {} }
}

function hmac(key: Buffer | string, value: string) {
    return createHmac('sha256', key).update(value).digest()
}

async function sendViaAwsSes(publicConfig: Record<string, any>, secrets: Record<string, any>, to: string, subject: string, body: string, fromEmail: string) {
    const region = publicConfig.aws_region || 'us-east-1'
    const host = `email.${region}.amazonaws.com`
    const payload = JSON.stringify({
        FromEmailAddress: fromEmail,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: { Text: { Data: body, Charset: 'UTF-8' } } } },
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

async function sendEmailWithActiveProvider(supabase: any, orgId: string, to: string, subject: string, body: string) {
    const { data: config } = await supabase
        .from('notification_provider_configs')
        .select('*')
        .eq('org_id', orgId)
        .eq('channel', 'email')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (!config) return { success: false, error: 'Email provider not configured' }
    const publicConfig = config.config_public || {}
    const secrets = parseProviderSecrets(config.config_encrypted)
    const fromEmail = publicConfig.from_email || publicConfig.gmail_email
    const fromName = publicConfig.from_name || 'Serapod2U'

    try {
        if (config.provider_name === 'aws_ses') {
            return await sendViaAwsSes(publicConfig, secrets, to, subject, body, fromEmail)
        }

        if (config.provider_name === 'smtp') {
            const nodemailer = require('nodemailer')
            const transporter = nodemailer.createTransport({
                host: publicConfig.smtp_host,
                port: Number(publicConfig.port || 587),
                secure: publicConfig.security === 'ssl' || Number(publicConfig.port) === 465,
                auth: { user: publicConfig.username || secrets.username, pass: secrets.password },
            })
            const result = await transporter.sendMail({ from: `"${fromName}" <${fromEmail}>`, to, subject, text: body })
            return { success: true, messageId: result.messageId }
        }

        if (config.provider_name === 'gmail') {
            const params = new URLSearchParams({
                client_id: publicConfig.oauth_client_id,
                client_secret: secrets.oauth_client_secret || publicConfig.oauth_client_secret,
                refresh_token: secrets.oauth_refresh_token || publicConfig.oauth_refresh_token,
                grant_type: 'refresh_token',
            })
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params })
            const token = await tokenResponse.json()
            if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || 'Unable to refresh Gmail access token')
            const nodemailer = require('nodemailer')
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { type: 'OAuth2', user: publicConfig.gmail_email, clientId: publicConfig.oauth_client_id, clientSecret: secrets.oauth_client_secret, refreshToken: secrets.oauth_refresh_token, accessToken: token.access_token },
            })
            const result = await transporter.sendMail({ from: `"${fromName}" <${publicConfig.gmail_email}>`, to, subject, text: body })
            return { success: true, messageId: result.messageId }
        }

        let response: Response
        if (config.provider_name === 'sendgrid') {
            response = await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST', headers: { Authorization: `Bearer ${secrets.api_key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: fromEmail, name: fromName }, subject, content: [{ type: 'text/plain', value: body }] }),
            })
        } else if (config.provider_name === 'resend') {
            response = await fetch('https://api.resend.com/emails', {
                method: 'POST', headers: { Authorization: `Bearer ${secrets.api_key}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [to], subject, text: body }),
            })
        } else if (config.provider_name === 'postmark') {
            response = await fetch('https://api.postmarkapp.com/email', {
                method: 'POST', headers: { 'X-Postmark-Server-Token': secrets.api_token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ From: `${fromName} <${fromEmail}>`, To: to, Subject: subject, TextBody: body }),
            })
        } else if (config.provider_name === 'mailgun') {
            const regionHost = publicConfig.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net'
            const form = new FormData()
            form.set('from', `${fromName} <${fromEmail}>`); form.set('to', to); form.set('subject', subject); form.set('text', body)
            response = await fetch(`https://${regionHost}/v3/${publicConfig.domain}/messages`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`api:${secrets.api_key}`).toString('base64')}` }, body: form })
        } else {
            return { success: false, error: `Email provider ${config.provider_name} is not supported by the notification worker` }
        }

        const responseBody = await response.text()
        if (!response.ok) return { success: false, error: `${config.provider_name} returned ${response.status}: ${responseBody}` }
        let messageId: string | null = response.headers.get('x-message-id')
        try { messageId ||= JSON.parse(responseBody)?.id || null } catch { }
        return { success: true, messageId }
    } catch (error: any) {
        return { success: false, error: error.message || 'Email delivery failed' }
    }
}

export async function GET(request: NextRequest) {
    const startTime = Date.now()
    const supabase = createAdminClient()

    try {
        // 1. Fetch pending notifications from outbox (uses FOR UPDATE SKIP LOCKED)
        const { data: pendingItems, error: fetchError } = await supabase
            .rpc('get_pending_notifications', { p_limit: 20 })

        if (fetchError) {
            // Graceful handling: RPC may not exist on staging or network may be flaky
            console.warn('[NotifWorker] Error fetching pending:', fetchError.message)
            return NextResponse.json({ processed: 0, message: 'Skipped: ' + fetchError.message })
        }

        if (!pendingItems || pendingItems.length === 0) {
            return NextResponse.json({ processed: 0, message: 'No pending notifications' })
        }

        console.log(`[NotifWorker] Processing ${pendingItems.length} notification(s)`)

        let sent = 0
        let failed = 0

        for (const item of pendingItems) {
            try {
                const { id, org_id, event_code, channel, to_phone, to_email, template_code, payload_json, provider_name, retry_count } = item

                // 2. Get the notification template
                let templateBody = ''

                // Fetch notification settings (use 'any' cast since DB has extra jsonb cols not in TypeScript types)
                const { data: rawSetting } = await supabase
                    .from('notification_settings')
                    .select('*')
                    .eq('org_id', org_id)
                    .eq('event_code', event_code)
                    .single()

                const notifSetting = rawSetting as any

                // Try DB message_templates first
                const effectiveTemplateCode = notifSetting?.template_code || template_code
                if (effectiveTemplateCode) {
                    const { data: dbTemplate } = await supabase
                        .from('message_templates')
                        .select('body')
                        .eq('org_id', org_id)
                        .eq('code', effectiveTemplateCode)
                        .eq('channel', channel)
                        .eq('is_active', true)
                        .single()

                    if (dbTemplate?.body) {
                        templateBody = dbTemplate.body
                    }
                }

                // Check notification_settings.templates jsonb column (set via the UI drawer)
                if (!templateBody && notifSetting?.templates && notifSetting.templates[channel]) {
                    templateBody = notifSetting.templates[channel]
                }

                // Last fallback — use a built-in default
                if (!templateBody) {
                    if (event_code === 'order_submitted') {
                        templateBody = `📋 *New Order Pending Approval*\n\n*Order:* #{{order_no}}\n*Date:* {{order_date}}\n*Customer:* {{customer_name}}\n*Total:* RM {{amount}}\n\nThis order requires your review and approval.`
                    } else if (event_code === 'order_approved') {
                        templateBody = `✅ Order #{{order_no}} has been approved.\nAmount: RM {{amount}}\nStatus: {{status}}`
                    } else if (event_code === 'user_created_shop') {
                        templateBody = `🏪 *User Created New Shop*\n\n*Shop:* {{shop_name}}\n*Branch:* {{shop_branch}}\n*State:* {{shop_state}}\n*Created by:* {{creator_name}}\n*Creator email:* {{creator_email}}\n*Contact phone:* {{contact_phone}}\n*Created at:* {{created_at}}`
                    } else if (event_code === 'roadtour_qr_delivery') {
                        templateBody = `Your RoadTour QR is ready.\n\nCampaign: {{campaign_name}}\nReference: {{reference_name}}\n\nOpen QR: {{qr_url}}\nQR image: {{qr_image_url}}`
                    } else {
                        templateBody = `Update: ${event_code} occurred.\nOrder: {{order_no}}\nStatus: {{status}}`
                    }
                }

                // 3. Render the template with payload
                const payload = (typeof payload_json === 'object' && payload_json !== null && !Array.isArray(payload_json))
                    ? payload_json as Record<string, any>
                    : {}
                const messageBody = renderTemplate(templateBody, payload)

                // 4. Resolve recipients if to_phone/to_email not set
                let recipientPhone = to_phone
                let recipientEmail = to_email

                if (!recipientPhone && !recipientEmail) {
                    // Look up recipients from notification_settings (already fetched above)
                    if (notifSetting) {
                        const recipients = new Set<string>()
                        const recipientConfig = notifSetting.recipient_config || {}
                        const recipientTargets = recipientConfig.recipient_targets || {}

                        const addRecipients = (values: Array<string | null | undefined>) => {
                            for (const value of values) {
                                const normalized = String(value || '').trim()
                                if (normalized) {
                                    recipients.add(normalized)
                                }
                            }
                        }

                        // Check recipient_config.recipient_users (new format from UI drawer)
                        const configUsers = notifSetting.recipient_config?.recipient_users
                        // Also check legacy recipient_users column
                        const legacyUsers = notifSetting.recipient_users
                        const userIds = configUsers?.length ? configUsers : legacyUsers?.length ? legacyUsers : []

                        if (userIds.length) {
                            const { data: users } = await supabase
                                .from('users')
                                .select('phone, email')
                                .in('id', userIds)

                            if (users) {
                                addRecipients(users.map((u) => channel === 'email' ? u.email : u.phone))
                            }
                        }

                        const configuredRoles = Array.isArray(recipientConfig.roles) && recipientConfig.roles.length > 0
                            ? recipientConfig.roles
                            : Array.isArray(notifSetting.recipient_roles) && notifSetting.recipient_roles.length > 0
                                ? notifSetting.recipient_roles
                                : []
                        const resolvedRoleCodes = expandNotificationRoleCodes(configuredRoles)
                        const hasExplicitRecipientTargets = Object.keys(recipientTargets).length > 0
                        const rolesEnabled = configuredRoles.length > 0 && (
                            hasExplicitRecipientTargets
                                ? recipientTargets.roles === true
                                : recipientConfig.type === 'roles' || Boolean(notifSetting.recipient_roles?.length)
                        )

                        if (rolesEnabled && resolvedRoleCodes.length > 0) {
                            const { data: roleUsers } = await supabase
                                .from('users')
                                .select('phone, email')
                                .eq('organization_id', org_id)
                                .in('role_code', resolvedRoleCodes)

                            if (roleUsers) {
                                addRecipients(roleUsers.map((user) => channel === 'email' ? user.email : user.phone))
                            }
                        }

                        // Custom phone numbers
                        if (notifSetting.recipient_custom?.length) {
                            addRecipients(notifSetting.recipient_custom)
                        }

                        if (channel === 'email') {
                            addRecipients(splitConfiguredRecipients(recipientConfig.custom_emails))
                        } else {
                            addRecipients(splitConfiguredRecipients(recipientConfig.custom_phones))
                        }

                        // Manual WhatsApp numbers (digits-only normalized form, no plus sign)
                        if (channel === 'whatsapp' && Array.isArray(recipientConfig.manual_whatsapp_numbers)) {
                            // Re-validate & dedupe server-side as a safety net
                            const { normalizeAndDedupeManualPhones } = await import('@/lib/notifications/manualPhoneNumbers')
                            const cleaned = normalizeAndDedupeManualPhones(recipientConfig.manual_whatsapp_numbers)
                            addRecipients(cleaned)
                        }

                        const recipientList = Array.from(recipients)

                        if (recipientList.length > 0) {
                            if (channel === 'email') {
                                recipientEmail = recipientList[0]
                            } else {
                                recipientPhone = recipientList[0]
                            }

                            // For additional recipients, queue separate messages
                            for (let i = 1; i < recipientList.length; i++) {
                                const additionalPhone = channel !== 'email' ? recipientList[i] : null
                                const additionalEmail = channel === 'email' ? recipientList[i] : null

                                await supabase.from('notifications_outbox').insert({
                                    org_id,
                                    event_code,
                                    channel,
                                    to_phone: additionalPhone,
                                    to_email: additionalEmail,
                                    template_code,
                                    payload_json,
                                    priority: 'normal',
                                    provider_name,
                                    status: 'queued',
                                    retry_count: 0,
                                    max_retries: 3,
                                    created_at: new Date().toISOString()
                                })
                            }
                        }
                    }
                }

                if ((recipientPhone || recipientEmail) && (recipientPhone !== to_phone || recipientEmail !== to_email)) {
                    const recipientUpdate: Record<string, string | null> = {}

                    if (recipientPhone !== to_phone) {
                        recipientUpdate.to_phone = recipientPhone || null
                    }
                    if (recipientEmail !== to_email) {
                        recipientUpdate.to_email = recipientEmail || null
                    }

                    if (Object.keys(recipientUpdate).length > 0) {
                        const { error: recipientUpdateError } = await supabase
                            .from('notifications_outbox')
                            .update(recipientUpdate)
                            .eq('id', id)

                        if (recipientUpdateError) {
                            console.warn(`[NotifWorker] Failed to persist resolved recipient for ${id}: ${recipientUpdateError.message}`)
                        }
                    }
                }

                // If still no recipient, mark as failed
                if (!recipientPhone && !recipientEmail) {
                    const fallbackPayload = payload_json && typeof payload_json === 'object' && !Array.isArray(payload_json)
                        ? payload_json as Record<string, any>
                        : {}
                    const isFallbackEmail = channel === 'email' && Boolean(fallbackPayload._routing_fallback || fallbackPayload._routing_fallback_for)
                    await supabase.rpc('log_notification_attempt', {
                        p_outbox_id: id,
                        p_status: 'failed',
                        p_error_message: isFallbackEmail
                            ? 'Fallback Email required, but the recipient has no email address. Ask the admin or user to update the email first.'
                            : 'No recipient found — check notification settings recipients'
                    })
                    failed++
                    continue
                }

                // 5. Send via the appropriate channel
                if (channel === 'whatsapp' && recipientPhone) {
                    const config = await getWhatsAppConfig(supabase, org_id)

                    if (!config) {
                        await supabase.rpc('log_notification_attempt', {
                            p_outbox_id: id,
                            p_status: 'failed',
                            p_error_message: 'No default WhatsApp provider configured for this organization'
                        })
                        await queueEmailFallback(supabase, item, recipientPhone, 'whatsapp_unavailable')
                        await supabase.from('notifications_outbox').update({ status: 'cancelled' }).eq('id', id)
                        failed++
                        continue
                    }

                    try {
                        const sentResult = await sendWhatsAppMessage(supabase, org_id, { to: recipientPhone, text: messageBody })
                        const gwResult = sentResult.response

                        if (gwResult.ok || gwResult.success || gwResult.jid || gwResult.messageId) {
                            await supabase.rpc('log_notification_attempt', {
                                p_outbox_id: id,
                                p_status: 'sent',
                                p_provider_message_id: gwResult.jid || gwResult.messageId || null,
                                p_provider_response: gwResult
                            })
                            sent++
                        } else {
                            await supabase.rpc('log_notification_attempt', {
                                p_outbox_id: id,
                                p_status: 'failed',
                                p_error_message: gwResult.error || 'Gateway returned error',
                                p_provider_response: gwResult
                            })
                            if (Number(retry_count || 0) >= 2) {
                                await queueEmailFallback(supabase, item, recipientPhone, 'whatsapp_delivery_failed')
                            }
                            failed++
                        }
                    } catch (gwError: any) {
                        await supabase.rpc('log_notification_attempt', {
                            p_outbox_id: id,
                            p_status: 'failed',
                            p_error_message: gwError.message || 'Gateway request failed'
                        })
                        if (Number(retry_count || 0) >= 2) {
                            await queueEmailFallback(supabase, item, recipientPhone, 'whatsapp_delivery_failed')
                        }
                        failed++
                    }
                } else if (channel === 'sms') {
                    // SMS sending placeholder
                    await supabase.rpc('log_notification_attempt', {
                        p_outbox_id: id,
                        p_status: 'failed',
                        p_error_message: 'SMS provider not yet configured'
                    })
                    failed++
                } else if (channel === 'email') {
                    const emailSubject = event_code === 'roadtour_qr_delivery'
                        ? `RoadTour QR — ${String(payload.campaign_name || 'Campaign')}`
                        : `Serapod2U notification: ${String(event_code).replace(/_/g, ' ')}`
                    const emailResult = await sendEmailWithActiveProvider(
                        supabase,
                        org_id,
                        recipientEmail!,
                        emailSubject,
                        messageBody
                    )
                    await supabase.rpc('log_notification_attempt', emailResult.success ? {
                        p_outbox_id: id,
                        p_status: 'sent',
                        p_provider_message_id: emailResult.messageId || null,
                        p_provider_response: { provider: provider_name },
                    } : {
                        p_outbox_id: id,
                        p_status: 'failed',
                        p_error_message: emailResult.error || 'Email delivery failed',
                    })
                    if (emailResult.success) sent++
                    else failed++
                } else {
                    await supabase.rpc('log_notification_attempt', {
                        p_outbox_id: id,
                        p_status: 'failed',
                        p_error_message: `Unsupported channel: ${channel} or missing recipient`
                    })
                    failed++
                }

            } catch (itemError: any) {
                console.error(`[NotifWorker] Error processing item ${item.id}:`, itemError)
                try {
                    await supabase.rpc('log_notification_attempt', {
                        p_outbox_id: item.id,
                        p_status: 'failed',
                        p_error_message: itemError.message || 'Processing error'
                    })
                } catch { }
                failed++
            }
        }

        const elapsed = Date.now() - startTime
        console.log(`[NotifWorker] Done: ${sent} sent, ${failed} failed in ${elapsed}ms`)

        return NextResponse.json({
            processed: pendingItems.length,
            sent,
            failed,
            elapsed_ms: elapsed
        })

    } catch (error: any) {
        console.error('[NotifWorker] Fatal error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
