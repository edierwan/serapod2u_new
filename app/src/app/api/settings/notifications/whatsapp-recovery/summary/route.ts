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

export const dynamic = 'force-dynamic'

const RECOVERY_PURPOSES = [
    'recovery_notice',
    'password_reset_recovery',
    'registration_recovery',
    'qr_claim_recovery',
]

export async function GET(_req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const admin = await isAdminUser(supabase, user.id)
        if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
        const todayIso = todayStart.toISOString()
        const last24Iso = new Date(Date.now() - 24 * 3600_000).toISOString()

        // Failed today — failed sends across notification_events (any WA purpose) today
        const { count: failedToday } = await supabase
            .from('notification_events')
            .select('id', { count: 'exact', head: true })
            .eq('channel', 'whatsapp')
            .in('status', ['failed', 'send_failed'])
            .gte('created_at', todayIso)

        // Recovery sent — count of recovery_* events with status sent
        const { count: recoverySent } = await supabase
            .from('notification_events')
            .select('id', { count: 'exact', head: true })
            .eq('channel', 'whatsapp')
            .in('purpose', RECOVERY_PURPOSES)
            .in('status', ['sent', 'recovery_sent'])
            .gte('created_at', last24Iso)

        // Delivered — events status = 'delivered'
        const { count: delivered } = await supabase
            .from('notification_events')
            .select('id', { count: 'exact', head: true })
            .eq('channel', 'whatsapp')
            .eq('status', 'delivered')
            .gte('created_at', last24Iso)

        // Read — events status = 'read'
        const { count: readCount } = await supabase
            .from('notification_events')
            .select('id', { count: 'exact', head: true })
            .eq('channel', 'whatsapp')
            .eq('status', 'read')
            .gte('created_at', last24Iso)

        // Resolved — verified or completed within recovery window
        const { count: resolved } = await supabase
            .from('notification_events')
            .select('id', { count: 'exact', head: true })
            .eq('channel', 'whatsapp')
            .in('status', ['verified', 'completed'])
            .gte('created_at', last24Iso)

        // Trend (last 24 hours, hourly buckets)
        const { data: trendRows } = await supabase
            .from('notification_events')
            .select('created_at, status, purpose')
            .eq('channel', 'whatsapp')
            .gte('created_at', last24Iso)
            .limit(5000)

        const trend: { hour: string; failed: number; recoverySent: number; delivered: number; read: number }[] = []
        const buckets = new Map<string, { failed: number; recoverySent: number; delivered: number; read: number }>()
        for (let i = 23; i >= 0; i--) {
            const h = new Date(Date.now() - i * 3600_000)
            h.setMinutes(0, 0, 0)
            const key = h.toISOString().slice(0, 13)
            buckets.set(key, { failed: 0, recoverySent: 0, delivered: 0, read: 0 })
        }
        for (const r of trendRows || []) {
            const key = String((r as any).created_at).slice(0, 13)
            const b = buckets.get(key)
            if (!b) continue
            const status = String((r as any).status || '')
            const purpose = String((r as any).purpose || '')
            if (status === 'failed' || status === 'send_failed') b.failed++
            if (RECOVERY_PURPOSES.includes(purpose) && (status === 'sent' || status === 'recovery_sent')) b.recoverySent++
            if (status === 'delivered') b.delivered++
            if (status === 'read') b.read++
        }
        for (const [hour, v] of buckets.entries()) {
            trend.push({ hour: `${hour.slice(11, 13)}:00`, ...v })
        }

        // Counts of failed-by-purpose for Quick Actions
        const { data: failedByPurposeRows } = await supabase
            .from('notification_events')
            .select('purpose')
            .eq('channel', 'whatsapp')
            .in('status', ['failed', 'send_failed'])
            .gte('created_at', last24Iso)
            .limit(5000)
        const failedByPurpose: Record<string, number> = {}
        for (const r of failedByPurposeRows || []) {
            const p = String((r as any).purpose || 'system')
            failedByPurpose[p] = (failedByPurpose[p] || 0) + 1
        }

        return NextResponse.json({
            kpis: {
                failedToday: failedToday || 0,
                recoverySent: recoverySent || 0,
                delivered: delivered || 0,
                read: readCount || 0,
                resolved: resolved || 0,
            },
            trend,
            failedByPurpose,
        })
    } catch (e: any) {
        console.error('[wa-recovery/summary]', e)
        return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
    }
}
