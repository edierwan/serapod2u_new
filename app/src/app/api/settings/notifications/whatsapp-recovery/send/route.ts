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

import { getWhatsAppConfig, isAdminUser, callGateway } from '@/app/api/settings/whatsapp/_utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { resolveRecoveryContacts } from '@/lib/wa-recovery/contact-resolver'
import { loadRecoveryTemplates, pickRecoveryTemplate } from '@/lib/wa-recovery/template-store'
import {
    buildRecoveryMessageVariables,
    renderTemplate,
} from '@/lib/wa-recovery/templates'
import { normalizePhoneE164, toProviderPhone } from '@/utils/phone'

export const dynamic = 'force-dynamic'

interface SendResult {
    phone: string
    status: 'sent' | 'failed' | 'skipped_dedupe' | 'invalid'
    templateKey?: string
    messageId?: string | null
    error?: string
}

interface SendTarget {
    sourceType?: string | null
    sourceRecordId?: string | null
    sourceKey?: string | null
    phone: string
    failedPurpose?: string | null
    failedAt?: string | null
    provider?: string | null
    userId?: string | null
    resolvedName?: string | null
    resolvedSource?: string | null
}

const RECOVERY_PURPOSES = [
    'recovery_notice',
    'password_reset_recovery',
    'registration_recovery',
    'qr_claim_recovery',
]

function normalizePhone(phone: string): string {
    return normalizePhoneE164(phone)
}

function makeSourceKey(target: SendTarget, fallbackIndex: number) {
    return String(target.sourceKey || `${target.sourceType || 'bulk'}:${target.sourceRecordId || fallbackIndex}`)
}

function mapBodyTargets(body: any): SendTarget[] {
    if (Array.isArray(body.records) && body.records.length > 0) {
        return body.records.map((record: any) => ({
            sourceType: record.sourceType,
            sourceRecordId: record.sourceRecordId,
            sourceKey: record.sourceKey,
            phone: String(record.phone || record.recipientPhone || ''),
            failedPurpose: record.failedPurpose || record.purpose,
            failedAt: record.failedAt || record.createdAt || null,
            provider: record.provider || null,
            userId: record.userId || record.resolvedUserId || null,
            resolvedName: record.resolvedName || record.contactName || null,
            resolvedSource: record.resolvedSource || record.contactSource || null,
        }))
    }

    if (body.record) {
        return mapBodyTargets({ records: [body.record] })
    }

    if (Array.isArray(body.phones)) {
        return body.phones.map((phone: string) => ({
            phone,
            failedPurpose: body.filterPurpose || body.failedPurpose || null,
        }))
    }

    if (body.phone) {
        return [{ phone: body.phone, failedPurpose: body.failedPurpose || null }]
    }

    return []
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const admin = await isAdminUser(supabase, user.id)
        if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

        const supabaseAdmin = createAdminClient()
        const { data: profile } = await (supabaseAdmin as any)
            .from('users').select('organization_id').eq('id', user.id).single()
        const orgId = profile?.organization_id
        if (!orgId) return NextResponse.json({ error: 'No organization' }, { status: 400 })

        const config = await getWhatsAppConfig(supabaseAdmin as any, orgId)
        if (!config?.baseUrl || !config?.apiKey) {
            return NextResponse.json({ error: 'WhatsApp gateway not configured' }, { status: 400 })
        }

        const body = await request.json()
        const mode: 'single' | 'bulk' = body.mode === 'bulk' ? 'bulk' : 'single'
        const dedupeWindowHours = Number(body.dedupeWindowHours ?? 24)
        const dedupeCutoff = new Date(Date.now() - dedupeWindowHours * 3600_000).toISOString()
        const allowResend = body.allowResend === true
        const customMessage = String(body.customMessage || '').trim()
        const targets = mapBodyTargets(body)
        if (targets.length === 0) {
            return NextResponse.json({ error: mode === 'bulk' ? 'records[] or phones[] required' : 'record or phone required' }, { status: 400 })
        }

        const templates = await loadRecoveryTemplates(supabaseAdmin as any, orgId)
        const contactResolutions = await resolveRecoveryContacts(
            supabaseAdmin as any,
            targets.map((target, index) => ({
                key: makeSourceKey(target, index),
                phone: target.phone,
                userId: target.userId,
            })),
        )

        const skipPhones = new Set<string>()
        const skipSourceKeys = new Set<string>()
        if (targets.length > 0 && dedupeWindowHours > 0) {
            const phoneList = Array.from(new Set(targets.map(target => normalizePhone(target.phone)).filter(Boolean)))
            const { data: recent } = await (supabaseAdmin as any)
                .from('notification_events')
                .select('recipient_phone, purpose, status, meta, created_at')
                .eq('channel', 'whatsapp')
                .in('purpose', RECOVERY_PURPOSES)
                .gte('created_at', dedupeCutoff)
                .in('recipient_phone', phoneList)
            for (const row of recent || []) {
                const meta = typeof (row as any).meta === 'object' && (row as any).meta !== null ? (row as any).meta : {}
                const normalizedPhone = normalizePhone((row as any).recipient_phone)
                if (normalizedPhone) skipPhones.add(normalizedPhone)
                const sourceKey = String((meta as any).source_key || '').trim()
                if (sourceKey) skipSourceKeys.add(sourceKey)
            }
        }

        const results: SendResult[] = []
        let sent = 0, failed = 0, skipped = 0
        for (const [index, target] of targets.entries()) {
            const phone = normalizePhone(target.phone)
            const sourceKey = makeSourceKey(target, index)
            if (!phone) {
                results.push({ phone: target.phone, status: 'invalid' })
                failed++
                continue
            }

            if (!allowResend && (skipSourceKeys.has(sourceKey) || (mode === 'bulk' && skipPhones.has(phone)))) {
                results.push({ phone, status: 'skipped_dedupe' })
                skipped++
                continue
            }

            const resolution = contactResolutions[sourceKey]
            const template = pickRecoveryTemplate(templates, target.failedPurpose, body.templateKey)
            const messageBody = customMessage || renderTemplate(
                template.body,
                buildRecoveryMessageVariables({
                    failedPurpose: target.failedPurpose,
                    failedAt: target.failedAt,
                    recipientName: resolution?.displayName === 'Unknown contact' ? null : (target.resolvedName || resolution?.displayName || null),
                }),
            )
            const providerPhone = toProviderPhone(phone)
            if (!providerPhone) {
                results.push({ phone, status: 'invalid', templateKey: template.key, error: 'Invalid phone number' })
                failed++
                continue
            }

            try {
                const result = await callGateway(
                    config.baseUrl, config.apiKey, 'POST', '/messages/send',
                    { to: providerPhone, text: messageBody }, config.tenantId,
                )
                const messageId = result?.key?.id || result?.messageId || null
                results.push({ phone, status: 'sent', templateKey: template.key, messageId })
                sent++

                await (supabaseAdmin as any).from('notification_events').insert({
                    channel: 'whatsapp',
                    provider: 'baileys',
                    event_type: `${template.key}_sent`,
                    purpose: template.key,
                    recipient_phone: phone,
                    user_id: resolution?.userId || target.userId || null,
                    related_entity_type: target.sourceType || null,
                    related_entity_id: target.sourceRecordId || null,
                    message_template: customMessage ? 'custom' : template.key,
                    message_body: messageBody,
                    status: 'recovery_sent',
                    provider_message_id: messageId,
                    meta: {
                        mode,
                        template_key: template.key,
                        resolved_name: target.resolvedName || resolution?.displayName || null,
                        resolved_source: target.resolvedSource || resolution?.sourceLabel || 'Unknown',
                        source_key: sourceKey,
                        source_record_id: target.sourceRecordId || null,
                        source_type: target.sourceType || null,
                        failed_purpose: target.failedPurpose || null,
                        failed_at: target.failedAt || null,
                        original_provider: target.provider || null,
                        triggered_by: user.id,
                        allow_resend: allowResend,
                    },
                    requested_at: new Date().toISOString(),
                    sent_at: new Date().toISOString(),
                })
            } catch (e: any) {
                results.push({ phone, status: 'failed', templateKey: template.key, error: e?.message || 'send failed' })
                failed++
                try {
                    await (supabaseAdmin as any).from('notification_events').insert({
                        channel: 'whatsapp',
                        provider: 'baileys',
                        event_type: `${template.key}_failed`,
                        purpose: template.key,
                        recipient_phone: phone,
                        user_id: resolution?.userId || target.userId || null,
                        related_entity_type: target.sourceType || null,
                        related_entity_id: target.sourceRecordId || null,
                        message_template: customMessage ? 'custom' : template.key,
                        message_body: messageBody,
                        status: 'failed',
                        error_message: e?.message || 'send failed',
                        meta: {
                            mode,
                            template_key: template.key,
                            resolved_name: target.resolvedName || resolution?.displayName || null,
                            resolved_source: target.resolvedSource || resolution?.sourceLabel || 'Unknown',
                            source_key: sourceKey,
                            source_record_id: target.sourceRecordId || null,
                            source_type: target.sourceType || null,
                            failed_purpose: target.failedPurpose || null,
                            failed_at: target.failedAt || null,
                            original_provider: target.provider || null,
                            triggered_by: user.id,
                            allow_resend: allowResend,
                        },
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
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const adminAllowed = await isAdminUser(supabase as any, user.id)
        if (!adminAllowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

        const admin = createAdminClient()
        const { data: profile } = await (admin as any)
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        if (!profile?.organization_id) {
            return NextResponse.json({ error: 'No organization' }, { status: 400 })
        }

        const templates = await loadRecoveryTemplates(admin as any, profile.organization_id)
        return NextResponse.json({ templates })
    } catch (error: any) {
        console.error('[wa-recovery/send:get]', error)
        return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
    }
}
