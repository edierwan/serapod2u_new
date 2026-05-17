import { NextRequest, NextResponse } from 'next/server'

import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
    isMonitoringDismissed,
    normalizeActivityMetadata,
    RECOVERY_PURPOSES,
} from '@/lib/wa-recovery/activity-status'
import { resolveRecoveryContacts } from '@/lib/wa-recovery/contact-resolver'
import { loadRecoveryTemplates, pickRecoveryTemplate } from '@/lib/wa-recovery/template-store'
import { buildRecoveryMessageVariables, renderTemplate } from '@/lib/wa-recovery/templates'
import { normalizePhoneE164 } from '@/utils/phone'

export const dynamic = 'force-dynamic'

const RECOVERY_PURPOSE_SET = new Set(RECOVERY_PURPOSES)

function parseProviderResponse(value: unknown): Record<string, any> | null {
    const parsed = normalizeActivityMetadata(value)
    return Object.keys(parsed).length > 0 ? parsed : null
}

function resolveLogRecipientPhone(recipient: unknown, providerResponse: unknown) {
    const direct = String(recipient || '').trim()
    if (direct && direct.toLowerCase() !== 'unknown') return direct

    const parsed = parseProviderResponse(providerResponse)
    const gatewayTarget = String(parsed?.to || parsed?.jid || '').trim()
    return gatewayTarget.replace(/@s\.whatsapp\.net$/i, '')
}

function inferPurpose(rawPurpose: unknown, rawEventType: unknown) {
    const explicitPurpose = String(rawPurpose || '').trim()
    if (explicitPurpose) return explicitPurpose

    const probe = String(rawEventType || '').toLowerCase()
    if (probe.includes('password_reset')) return 'password_reset'
    if (probe.includes('registration')) return 'registration_verification'
    if (probe.includes('phone_verification')) return 'phone_verification'
    if (probe.includes('qr') || probe.includes('claim')) return 'qr_consumer'
    return 'system'
}

function toRecoverySnapshot(row: any) {
    return {
        id: String(row.id),
        status: String(row.status || ''),
        createdAt: String(row.created_at || ''),
        sentAt: row.sent_at ? String(row.sent_at) : null,
        purpose: String(row.purpose || ''),
        messageBody: row.message_body ? String(row.message_body) : null,
        messageTemplate: row.message_template ? String(row.message_template) : null,
        errorMessage: row.error_message ? String(row.error_message) : null,
    }
}

export async function GET(_request: NextRequest) {
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

        const orgId = profile?.organization_id || null
        const [eventRowsRes, logRowsRes, templates] = await Promise.all([
            (admin as any)
                .from('notification_events')
                .select('id, created_at, requested_at, sent_at, status, recipient_phone, event_type, purpose, provider, error_message, provider_message_id, user_id, message_template, message_body, meta')
                .eq('channel', 'whatsapp')
                .order('created_at', { ascending: false })
                .limit(500),
            orgId
                ? (admin as any)
                    .from('notification_logs')
                    .select('id, created_at, sent_at, delivered_at, failed_at, status, recipient_value, event_code, provider_name, error_message, provider_response')
                    .eq('channel', 'whatsapp')
                    .eq('org_id', orgId)
                    .order('created_at', { ascending: false })
                    .limit(500)
                : Promise.resolve({ data: [], error: null }),
            orgId ? loadRecoveryTemplates(admin as any, orgId) : Promise.resolve([]),
        ])

        if (eventRowsRes.error) {
            return NextResponse.json({ error: eventRowsRes.error.message }, { status: 500 })
        }
        if (logRowsRes.error) {
            return NextResponse.json({ error: logRowsRes.error.message }, { status: 500 })
        }

        const eventRows = ((eventRowsRes.data || []) as any[]).filter((row) => !isMonitoringDismissed(row.meta))
        const logRows = ((logRowsRes.data || []) as any[]).filter((row) => !isMonitoringDismissed(row.provider_response))
        const recoveryBySourceKey = new Map<string, ReturnType<typeof toRecoverySnapshot>>()
        const recoveryByPhoneAndPurpose = new Map<string, ReturnType<typeof toRecoverySnapshot>>()

        for (const row of eventRows) {
            if (!RECOVERY_PURPOSE_SET.has(String(row.purpose || ''))) continue
            const meta = normalizeActivityMetadata(row.meta)
            const snapshot = toRecoverySnapshot(row)
            const sourceKey = String(meta.source_key || '').trim()
            if (sourceKey && !recoveryBySourceKey.has(sourceKey)) {
                recoveryBySourceKey.set(sourceKey, snapshot)
            }

            const normalizedPhone = normalizePhoneE164(String(row.recipient_phone || '').trim())
            if (normalizedPhone) {
                const fallbackKey = `${normalizedPhone}:${String(row.purpose || '')}`
                if (!recoveryByPhoneAndPurpose.has(fallbackKey)) {
                    recoveryByPhoneAndPurpose.set(fallbackKey, snapshot)
                }
            }
        }

        const records = [
            ...eventRows.map((row) => {
                const normalizedPhone = normalizePhoneE164(String(row.recipient_phone || '').trim()) || String(row.recipient_phone || '').trim()
                return {
                    id: `event-${row.id}`,
                    sourceType: 'notification_event',
                    sourceRecordId: String(row.id),
                    sourceKey: `notification_event:${row.id}`,
                    createdAt: String(row.created_at || row.requested_at || ''),
                    recipientPhone: normalizedPhone,
                    eventType: String(row.event_type || ''),
                    purpose: inferPurpose(row.purpose, row.event_type),
                    status: String(row.status || 'unknown'),
                    provider: String(row.provider || ''),
                    errorMessage: String(row.error_message || ''),
                    userId: row.user_id ? String(row.user_id) : null,
                    providerMessageId: row.provider_message_id ? String(row.provider_message_id) : null,
                    messageTemplate: row.message_template ? String(row.message_template) : null,
                    messageBody: row.message_body ? String(row.message_body) : null,
                    meta: normalizeActivityMetadata(row.meta),
                }
            }),
            ...logRows.map((row) => {
                const normalizedPhone = normalizePhoneE164(resolveLogRecipientPhone(row.recipient_value, row.provider_response))
                return {
                    id: `log-${row.id}`,
                    sourceType: 'notification_log',
                    sourceRecordId: String(row.id),
                    sourceKey: `notification_log:${row.id}`,
                    createdAt: String(row.sent_at || row.delivered_at || row.failed_at || row.created_at || ''),
                    recipientPhone: normalizedPhone,
                    eventType: String(row.event_code || ''),
                    purpose: inferPurpose(null, row.event_code),
                    status: String(row.status || 'unknown'),
                    provider: String(row.provider_name || ''),
                    errorMessage: String(row.error_message || ''),
                    userId: null,
                    providerMessageId: null,
                    messageTemplate: null,
                    messageBody: null,
                    meta: normalizeActivityMetadata(row.provider_response),
                }
            }),
        ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

        const contacts = await resolveRecoveryContacts(
            admin as any,
            records.map(record => ({
                key: record.sourceKey,
                phone: record.recipientPhone,
                userId: record.userId,
            })),
        )

        const enrichedRecords = records.map((record) => {
            const contact = contacts[record.sourceKey] || {
                normalizedPhone: record.recipientPhone,
                displayName: 'Unknown contact',
                sourceLabel: 'Unknown',
                userId: null,
                organizationId: null,
                matchedBy: 'none',
            }

            const selectedTemplate = pickRecoveryTemplate(templates, record.purpose)
            const previewBody = record.messageBody || renderTemplate(
                selectedTemplate.body,
                buildRecoveryMessageVariables({
                    failedPurpose: record.purpose,
                    failedAt: record.createdAt,
                    recipientName: contact.displayName === 'Unknown contact' ? null : contact.displayName,
                }),
            )
            const latestRecovery = RECOVERY_PURPOSE_SET.has(record.purpose)
                ? null
                : recoveryBySourceKey.get(record.sourceKey) || recoveryByPhoneAndPurpose.get(`${contact.normalizedPhone}:${selectedTemplate.key}`) || null

            return {
                ...record,
                recipientPhone: contact.normalizedPhone || record.recipientPhone,
                contactName: contact.displayName,
                contactSource: contact.sourceLabel,
                resolvedUserId: contact.userId,
                resolvedOrganizationId: contact.organizationId,
                suggestedTemplateKey: selectedTemplate.key,
                suggestedTemplateName: selectedTemplate.name,
                suggestedMessagePreview: previewBody,
                latestRecovery,
            }
        })

        return NextResponse.json({ records: enrichedRecords })
    } catch (error: any) {
        console.error('[wa-recovery/records]', error)
        return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
    }
}