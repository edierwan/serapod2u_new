/**
 * WhatsApp Recovery — Send Recovery Notification(s)
 *
 * POST /api/settings/notifications/whatsapp-recovery/send
 *
 * Sends recovery (system-restored) notifications to one or many phone numbers
 * via the existing Baileys gateway integration. This is NOT an OTP resend —
 * messages only inform users that the WhatsApp system is back online and ask
 * them to retry from the app.
 *
 * Request body:
 *   {
 *     mode: 'single' | 'bulk',
 *     // single mode:
 *     phone?: string,
 *     templateKey?: string,        // explicit template (else infer from purpose)
 *     customMessage?: string,      // overrides template body
 *     failedPurpose?: string,      // used to infer template if templateKey missing
 *     // bulk mode:
 *     phones?: string[],           // list of phone numbers
 *     filterPurpose?: string,      // for audit logging
 *     dedupeWindowHours?: number,  // default 24h — skip phones already sent recovery in window
 *   }
 *
 * Response:
 *   { ok: true, sent: number, skipped: number, failed: number, results: [...] }
 *
 * Security: Admin only. Goes through existing server-side baileys gateway.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getWhatsAppConfig, isAdminUser, callGateway } from '@/app/api/settings/whatsapp/_utils'
import {
    RECOVERY_TEMPLATES, getTemplateByKey, inferRecoveryTemplate, renderTemplate,
} from '@/lib/wa-recovery/templates'

export const dynamic = 'force-dynamic'

interface SendResult {
    phone: string
    status: 'sent' | 'failed' | 'skipped_dedupe' | 'invalid'
    templateKey?: string
    messageId?: string | null
    error?: string
}

function normalizePhone(p: string): string {
    return String(p || '').replace(/\D/g, '')
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const admin = await isAdminUser(supabase, user.id)
        if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

        const { data: profile } = await supabase
            .from('users').select('organization_id').eq('id', user.id).single()
        const orgId = profile?.organization_id
        if (!orgId) return NextResponse.json({ error: 'No organization' }, { status: 400 })

        const config = await getWhatsAppConfig(supabase, orgId)
        if (!config?.baseUrl || !config?.apiKey) {
            return NextResponse.json({ error: 'WhatsApp gateway not configured' }, { status: 400 })
        }

        const body = await request.json()
        const mode: 'single' | 'bulk' = body.mode === 'bulk' ? 'bulk' : 'single'
        const dedupeWindowHours = Number(body.dedupeWindowHours ?? 24)
        const dedupeCutoff = new Date(Date.now() - dedupeWindowHours * 3600_000).toISOString()

        // Resolve message body + template key
        function resolveMessage(failedPurpose?: string, templateKey?: string, customMessage?: string) {
            if (customMessage && customMessage.trim().length > 0) {
                return { body: customMessage.trim(), templateKey: 'custom' }
            }
            const tpl = templateKey
                ? (getTemplateByKey(templateKey) || inferRecoveryTemplate(failedPurpose))
                : inferRecoveryTemplate(failedPurpose)
            return { body: renderTemplate(tpl.body), templateKey: tpl.key }
        }

        const targets: { phone: string; failedPurpose?: string }[] = []
        if (mode === 'single') {
            if (!body.phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })
            targets.push({ phone: body.phone, failedPurpose: body.failedPurpose })
        } else {
            if (!Array.isArray(body.phones)) {
                return NextResponse.json({ error: 'phones[] required' }, { status: 400 })
            }
            const seen = new Set<string>()
            for (const p of body.phones) {
                const n = normalizePhone(p)
                if (!n || seen.has(n)) continue
                seen.add(n)
                targets.push({ phone: n, failedPurpose: body.filterPurpose })
            }
        }

        // Dedupe — check notification_events for recent recovery sends to these phones
        const skipPhones = new Set<string>()
        if (targets.length > 0 && mode === 'bulk' && dedupeWindowHours > 0) {
            const phoneList = targets.map(t => normalizePhone(t.phone))
            const { data: recent } = await supabase
                .from('notification_events')
                .select('recipient_phone, purpose')
                .eq('channel', 'whatsapp')
                .in('purpose', ['recovery_notice', 'password_reset_recovery', 'registration_recovery', 'qr_claim_recovery'])
                .gte('created_at', dedupeCutoff)
                .in('recipient_phone', phoneList)
            for (const r of recent || []) {
                skipPhones.add(normalizePhone((r as any).recipient_phone))
            }
        }

        const results: SendResult[] = []
        let sent = 0, failed = 0, skipped = 0
        for (const t of targets) {
            const phone = normalizePhone(t.phone)
            if (!phone) { results.push({ phone: t.phone, status: 'invalid' }); failed++; continue }
            if (skipPhones.has(phone)) {
                results.push({ phone, status: 'skipped_dedupe' }); skipped++; continue
            }

            const { body: msg, templateKey } = resolveMessage(t.failedPurpose, body.templateKey, body.customMessage)

            try {
                const result = await callGateway(
                    config.baseUrl, config.apiKey, 'POST', '/messages/send',
                    { to: phone, text: msg }, config.tenantId,
                )
                const messageId = result?.key?.id || result?.messageId || null
                results.push({ phone, status: 'sent', templateKey, messageId })
                sent++

                // Log to notification_events for audit + dedupe
                await supabase.from('notification_events').insert({
                    channel: 'whatsapp',
                    provider: 'baileys',
                    event_type: `${templateKey}_sent`,
                    purpose: templateKey === 'custom' ? 'recovery_notice' : templateKey,
                    recipient_phone: phone,
                    user_id: null,
                    status: 'sent',
                    provider_message_id: messageId,
                    meta: { mode, template_key: templateKey, triggered_by: user.id },
                    requested_at: new Date().toISOString(),
                    sent_at: new Date().toISOString(),
                })
            } catch (e: any) {
                results.push({ phone, status: 'failed', templateKey, error: e?.message || 'send failed' })
                failed++
                try {
                    await supabase.from('notification_events').insert({
                        channel: 'whatsapp',
                        provider: 'baileys',
                        event_type: `${templateKey}_failed`,
                        purpose: templateKey === 'custom' ? 'recovery_notice' : templateKey,
                        recipient_phone: phone,
                        user_id: null,
                        status: 'failed',
                        error_message: e?.message || 'send failed',
                        meta: { mode, template_key: templateKey, triggered_by: user.id },
                        requested_at: new Date().toISOString(),
                        failed_at: new Date().toISOString(),
                    })
                } catch { /* swallow logging error */ }
            }
        }

        return NextResponse.json({ ok: true, sent, skipped, failed, results })
    } catch (e: any) {
        console.error('[wa-recovery/send]', e)
        return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
    }
}

export async function GET() {
    // Expose templates for the UI
    return NextResponse.json({ templates: RECOVERY_TEMPLATES })
}
