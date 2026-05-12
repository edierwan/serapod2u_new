import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getWhatsAppConfig, callGateway } from '@/app/api/settings/whatsapp/_utils'
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
                const { id, org_id, event_code, channel, to_phone, to_email, template_code, payload_json, provider_name } = item

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
                    await supabase.rpc('log_notification_attempt', {
                        p_outbox_id: id,
                        p_status: 'failed',
                        p_error_message: 'No recipient found — check notification settings recipients'
                    })
                    failed++
                    continue
                }

                // 5. Send via the appropriate channel
                if (channel === 'whatsapp' && recipientPhone) {
                    const config = await getWhatsAppConfig(supabase, org_id)

                    if (!config || !config.baseUrl) {
                        await supabase.rpc('log_notification_attempt', {
                            p_outbox_id: id,
                            p_status: 'failed',
                            p_error_message: 'WhatsApp gateway not configured for this organization'
                        })
                        failed++
                        continue
                    }

                    try {
                        const gwResult = await callGateway(
                            config.baseUrl,
                            config.apiKey,
                            'POST',
                            '/messages/send',
                            { to: recipientPhone, text: messageBody },
                            config.tenantId
                        )

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
                            failed++
                        }
                    } catch (gwError: any) {
                        await supabase.rpc('log_notification_attempt', {
                            p_outbox_id: id,
                            p_status: 'failed',
                            p_error_message: gwError.message || 'Gateway request failed'
                        })
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
                    // Email sending placeholder
                    await supabase.rpc('log_notification_attempt', {
                        p_outbox_id: id,
                        p_status: 'failed',
                        p_error_message: 'Email provider not yet configured'
                    })
                    failed++
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
