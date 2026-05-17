/**
 * WhatsApp Recovery — Operations Summary
 *
 * GET /api/settings/notifications/whatsapp-recovery/summary
 *
 * Returns aggregated KPIs and a 24-hour delivery trend for the recovery
 * operations center. Reads from notification_events and notification_logs
 * (already populated by the existing OTP / WhatsApp send flows + the
 * recovery send endpoint).
 *
 * NOTE on read receipts:
 *   Baileys can surface delivered/read events when receipts are enabled on the
 *   gateway, but that capture is not currently wired into notification_events
 *   in this repo. The summary therefore reports "delivered" and "read" buckets
 *   when they exist (status = 'delivered' / 'read') and otherwise zero. The UI
 *   shows the metric regardless so capture can be added later without UI changes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAdminUser } from '@/app/api/settings/whatsapp/_utils'
import {
    addRecordToTrendPoint,
    createEmptyTrendPoint,
    hasTrendActivity,
    isFailedStatus,
    isMonitoringDismissed,
    isRecoveryPurpose,
    isRecoverySentStatus,
    isResolvedStatus,
    type RecoveryTrendPoint,
} from '@/lib/wa-recovery/activity-status'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const admin = await isAdminUser(supabase, user.id)
        if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

        const now = new Date()
        const last24Iso = new Date(now.getTime() - 24 * 3600_000).toISOString()

        const { data: trendRows } = await supabase
            .from('notification_events')
            .select('created_at, status, purpose, meta')
            .eq('channel', 'whatsapp')
            .gte('created_at', last24Iso)
            .limit(5000)

        const trend: RecoveryTrendPoint[] = []
        const buckets = new Map<string, RecoveryTrendPoint>()
        for (let i = 23; i >= 0; i--) {
            const h = new Date(now.getTime() - i * 3600_000)
            h.setMinutes(0, 0, 0)
            const key = h.toISOString().slice(0, 13)
            buckets.set(key, createEmptyTrendPoint(`${key.slice(11, 13)}:00`))
        }

        const kpis = {
            failed: 0,
            recoverySent: 0,
            delivered: 0,
            read: 0,
            resolved: 0,
        }
        const failedByPurpose: Record<string, number> = {}

        for (const r of trendRows || []) {
            if (isMonitoringDismissed((r as any).meta)) continue
            const key = String((r as any).created_at).slice(0, 13)
            const b = buckets.get(key)
            const status = String((r as any).status || '')
            const purpose = String((r as any).purpose || '')
            if (isFailedStatus(status)) {
                kpis.failed += 1
                failedByPurpose[purpose || 'system'] = (failedByPurpose[purpose || 'system'] || 0) + 1
            }
            if (isRecoveryPurpose(purpose) && isRecoverySentStatus(status)) kpis.recoverySent += 1
            if (status === 'delivered') kpis.delivered += 1
            if (status === 'read') kpis.read += 1
            if (isResolvedStatus(status)) kpis.resolved += 1
            if (!b) continue
            addRecordToTrendPoint(b, status, purpose)
        }
        for (const [hour, v] of buckets.entries()) {
            trend.push({ ...v, hour: `${hour.slice(11, 13)}:00` })
        }

        return NextResponse.json({
            kpis,
            trend,
            hasActivityLast24h: hasTrendActivity(trend),
            failedByPurpose,
        })
    } catch (e: any) {
        console.error('[wa-recovery/summary]', e)
        return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
    }
}
