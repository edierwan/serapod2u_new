import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/journey/dashboard-summary
 *
 * Aggregates Journey Builder KPIs, per-journey stats, daily scan trend, and
 * top performing journey for the current user's organization.
 *
 * Response shape:
 * {
 *   kpis: { totalJourneys, totalQrGenerated, totalScans, pointsRedeemed, failedScans },
 *   typeCounts: { points, luckyDraw, freeGift },
 *   trend: [{ date: 'YYYY-MM-DD', scans: number, redeemed: number, failed: number }, ...],
 *   journeys: [{ id, stats: { total_valid_links, links_scanned, redemptions, lucky_draw_entries, points_collected } }],
 *   topPerforming: { id, name, order_no, scans, redeemed, conversionRate, sparkline: number[] } | null,
 *   recentActivity: [{ id, type, title, location, time }],
 * }
 */
export async function GET(_req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { data: profile } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        const orgId = profile?.organization_id
        if (!orgId) return NextResponse.json({ error: 'No organization' }, { status: 400 })

        // 1) Load journeys for the org
        const { data: journeys, error: journeysErr } = await supabase
            .from('journey_configurations')
            .select('id, name, is_active, points_enabled, lucky_draw_enabled, redemption_enabled, enable_scratch_card_game, created_at')
            .eq('org_id', orgId)
            .order('created_at', { ascending: false })

        if (journeysErr) {
            console.error('[dashboard-summary] journeys error', journeysErr)
            return NextResponse.json({ error: 'Failed to load journeys' }, { status: 500 })
        }

        const journeyIds = (journeys || []).map(j => j.id)

        // 2) Map journey -> order
        const { data: links } = await supabase
            .from('journey_order_links')
            .select('journey_config_id, order_id')
            .in('journey_config_id', journeyIds.length ? journeyIds : ['00000000-0000-0000-0000-000000000000'])

        const orderIds = Array.from(new Set((links || []).map(l => l.order_id).filter(Boolean))) as string[]

        // 3) Per-journey QR stats via RPC for each order in parallel
        const statsByJourney: Record<string, any> = {}
        if (orderIds.length > 0) {
            const promises = (links || []).map(async (link) => {
                try {
                    const { data } = await supabase.rpc('get_consumer_scan_stats', { p_order_id: link.order_id }).single()
                    return { jid: link.journey_config_id, data }
                } catch {
                    return { jid: link.journey_config_id, data: null }
                }
            })
            const results = await Promise.all(promises)
            results.forEach(r => {
                const d: any = r.data || {}
                statsByJourney[r.jid] = {
                    total_valid_links: Number(d.total_qr_codes || 0),
                    links_scanned: Number(d.unique_consumer_scans || 0),
                    lucky_draw_entries: Number(d.lucky_draw_entries || 0),
                    redemptions: Number(d.redemptions || 0),
                    points_collected: Number(d.points_collected_count || 0),
                }
            })
        }

        // 4) Daily scan trend (last 12 months) — group consumer_qr_scans by day
        const trend: { date: string; scans: number; redeemed: number; failed: number }[] = []
        const trendLookbackDays = 365
        const trendStart = new Date(); trendStart.setDate(trendStart.getDate() - (trendLookbackDays - 1))
        const startIso = trendStart.toISOString().slice(0, 10)

        let scansByDay = new Map<string, number>()
        let redeemByDay = new Map<string, number>()
        if (orderIds.length > 0) {
            // Get QR codes for these orders
            const { data: qrCodes } = await supabase
                .from('qr_codes')
                .select('id')
                .in('order_id', orderIds)
                .limit(50000)
            const qrIds = (qrCodes || []).map((q: any) => q.id)

            if (qrIds.length > 0) {
                // Process in chunks to avoid IN-clause limits
                const chunkSize = 500
                for (let i = 0; i < qrIds.length; i += chunkSize) {
                    const chunk = qrIds.slice(i, i + chunkSize)
                    const { data: scans } = await supabase
                        .from('consumer_qr_scans')
                        .select('scanned_at, redeemed_at, collected_points')
                        .in('qr_code_id', chunk)
                        .gte('scanned_at', `${startIso}T00:00:00Z`)
                    for (const s of scans || []) {
                        const day = String((s as any).scanned_at).slice(0, 10)
                        scansByDay.set(day, (scansByDay.get(day) || 0) + 1)
                        if ((s as any).redeemed_at) {
                            redeemByDay.set(day, (redeemByDay.get(day) || 0) + 1)
                        }
                    }
                }
            }
        }
        for (let i = 0; i < trendLookbackDays; i++) {
            const d = new Date(trendStart); d.setDate(trendStart.getDate() + i)
            const key = d.toISOString().slice(0, 10)
            trend.push({ date: key, scans: scansByDay.get(key) || 0, redeemed: redeemByDay.get(key) || 0, failed: 0 })
        }

        // 5) KPIs
        let totalQrGenerated = 0, totalScans = 0, pointsRedeemed = 0
        for (const j of journeys || []) {
            const s = statsByJourney[j.id]
            if (!s) continue
            totalQrGenerated += s.total_valid_links
            totalScans += s.links_scanned
            pointsRedeemed += s.redemptions
        }

        // 6) Top performing
        let topPerforming: any = null
        if (journeys) {
            let best: any = null
            for (const j of journeys) {
                const s = statsByJourney[j.id]
                if (!s) continue
                const score = s.links_scanned + s.redemptions * 2
                if (!best || score > best.score) best = { journey: j, stats: s, score }
            }
            if (best) {
                const linkInfo = (links || []).find(l => l.journey_config_id === best.journey.id)
                let orderNo: string | null = null
                if (linkInfo?.order_id) {
                    const { data: ord } = await supabase
                        .from('orders')
                        .select('display_doc_no, order_no')
                        .eq('id', linkInfo.order_id)
                        .single()
                    orderNo = ord?.display_doc_no || ord?.order_no || null
                }
                const conv = best.stats.links_scanned > 0
                    ? Math.round((best.stats.redemptions / best.stats.links_scanned) * 1000) / 10
                    : 0
                topPerforming = {
                    id: best.journey.id,
                    name: best.journey.name,
                    order_no: orderNo,
                    scans: best.stats.links_scanned,
                    redeemed: best.stats.redemptions,
                    conversionRate: conv,
                    sparkline: trend.slice(-14).map(t => t.scans),
                }
            }
        }

        const typeCounts = {
            points: (journeys || []).filter(j => j.points_enabled).length,
            luckyDraw: (journeys || []).filter(j => j.lucky_draw_enabled).length,
            freeGift: (journeys || []).filter(j => j.redemption_enabled).length,
        }

        // 7) Recent activity (use latest 6 journeys creation as fallback)
        const recentActivity = (journeys || []).slice(0, 6).map(j => ({
            id: j.id,
            type: j.lucky_draw_enabled ? 'lucky_draw' : j.redemption_enabled ? 'free_gift' : 'points',
            title: `${j.name}`,
            location: null as string | null,
            time: j.created_at,
        }))

        return NextResponse.json({
            kpis: {
                totalJourneys: journeys?.length || 0,
                totalQrGenerated,
                totalScans,
                pointsRedeemed,
                failedScans: 0,
            },
            typeCounts,
            trend,
            journeys: Object.entries(statsByJourney).map(([id, stats]) => ({ id, stats })),
            topPerforming,
            recentActivity,
        })
    } catch (err: any) {
        console.error('[dashboard-summary] error', err)
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
    }
}
