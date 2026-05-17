import { NextRequest, NextResponse } from 'next/server'

import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
    applyMonitoringDismissedMetadata,
    isFailedStatus,
} from '@/lib/wa-recovery/activity-status'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const adminAllowed = await isAdminUser(supabase as any, user.id)
        if (!adminAllowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

        const body = await request.json()
        const sourceType = String(body.sourceType || '')
        const sourceRecordId = String(body.sourceRecordId || '')
        if (!sourceRecordId || !['notification_event', 'notification_log'].includes(sourceType)) {
            return NextResponse.json({ error: 'sourceType and sourceRecordId are required' }, { status: 400 })
        }

        const admin = createAdminClient()
        const dismissedAt = new Date().toISOString()

        if (sourceType === 'notification_event') {
            const { data: row, error } = await (admin as any)
                .from('notification_events')
                .select('id, channel, status, meta')
                .eq('id', sourceRecordId)
                .maybeSingle()

            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            if (!row) return NextResponse.json({ error: 'Failed activity not found' }, { status: 404 })
            if (row.channel !== 'whatsapp' || !isFailedStatus(row.status)) {
                return NextResponse.json({ error: 'Only failed WhatsApp activity can be cleared' }, { status: 400 })
            }

            const { error: updateError } = await (admin as any)
                .from('notification_events')
                .update({
                    meta: applyMonitoringDismissedMetadata(row.meta, {
                        dismissedAt,
                        dismissedBy: user.id,
                        reason: 'manual_clear_from_monitoring',
                        rawFallbackKey: 'raw_meta',
                    }),
                })
                .eq('id', sourceRecordId)

            if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
        } else {
            const { data: profile, error: profileError } = await (admin as any)
                .from('users')
                .select('organization_id')
                .eq('id', user.id)
                .single()

            if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 })
            if (!profile?.organization_id) {
                return NextResponse.json({ error: 'No organization found for user' }, { status: 400 })
            }

            const { data: row, error } = await (admin as any)
                .from('notification_logs')
                .select('id, org_id, channel, status, provider_response')
                .eq('id', sourceRecordId)
                .eq('org_id', profile.organization_id)
                .maybeSingle()

            if (error) return NextResponse.json({ error: error.message }, { status: 500 })
            if (!row) return NextResponse.json({ error: 'Failed activity not found' }, { status: 404 })
            if (row.channel !== 'whatsapp' || !isFailedStatus(row.status)) {
                return NextResponse.json({ error: 'Only failed WhatsApp activity can be cleared' }, { status: 400 })
            }

            const { error: updateError } = await (admin as any)
                .from('notification_logs')
                .update({
                    provider_response: applyMonitoringDismissedMetadata(row.provider_response, {
                        dismissedAt,
                        dismissedBy: user.id,
                        reason: 'manual_clear_from_monitoring',
                        rawFallbackKey: 'raw_provider_response',
                    }),
                })
                .eq('id', sourceRecordId)
                .eq('org_id', profile.organization_id)

            if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
        }

        return NextResponse.json({ ok: true, dismissedAt })
    } catch (error: any) {
        console.error('[wa-recovery/records/clear]', error)
        return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
    }
}