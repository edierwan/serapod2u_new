// Post-Visit Impact data loader for RoadTour Analytics.
// Pulls official visits + per-shop consumer_qr_scans counts in before/after windows.
'use client'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
    classifyImpactStatus,
    computeScanLiftPercent,
    type ImpactDataset,
    type ImpactSummary,
    type ImpactWindow,
    type VisitImpactRow,
} from '@/modules/roadtour/types/analytics'

export interface LoadImpactParams {
    supabase: SupabaseClient<any, any, any>
    companyId: string
    windowDays: ImpactWindow
    dateFrom?: string | null // ISO yyyy-mm-dd, filters visit_date
    dateTo?: string | null
    campaignId?: string | null
    accountManagerUserId?: string | null
    regionStateId?: string | null
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10) }

function addDays(iso: string, days: number) {
    const d = new Date(iso + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + days)
    return isoDate(d)
}

function daysBetween(aIso: string, bIso: string) {
    const a = new Date(aIso + 'T00:00:00Z').getTime()
    const b = new Date(bIso + 'T00:00:00Z').getTime()
    return Math.round((b - a) / 86400000)
}

function median(values: number[]): number | null {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const m = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m]
}

export async function loadPostVisitImpact(params: LoadImpactParams): Promise<ImpactDataset> {
    const {
        supabase, companyId, windowDays,
        dateFrom = null, dateTo = null,
        campaignId = null, accountManagerUserId = null, regionStateId = null,
    } = params

    const supa = supabase as any

    // 1) Campaigns scoped by org
    const { data: campaignRows, error: cErr } = await supa
        .from('roadtour_campaigns')
        .select('id, name, org_id')
        .eq('org_id', companyId)
    if (cErr) throw cErr
    const campaigns: Array<{ id: string; name: string }> = (campaignRows || []).map((c: any) => ({ id: c.id, name: c.name || '—' }))
    const campaignIds = campaigns.map((c) => c.id)

    if (campaignIds.length === 0) {
        return emptyDataset(windowDays, dateFrom, dateTo, 'No RoadTour campaigns found for this organization.')
    }

    // 2) Official visits in date range
    let visitsQuery = supa
        .from('roadtour_official_visits')
        .select('id, campaign_id, account_manager_user_id, shop_id, visit_date, notes, created_at')
        .in('campaign_id', campaignIds)
    if (campaignId) visitsQuery = visitsQuery.eq('campaign_id', campaignId)
    if (accountManagerUserId) visitsQuery = visitsQuery.eq('account_manager_user_id', accountManagerUserId)
    if (dateFrom) visitsQuery = visitsQuery.gte('visit_date', dateFrom)
    if (dateTo) visitsQuery = visitsQuery.lte('visit_date', dateTo)
    const { data: visitRows, error: vErr } = await visitsQuery.order('visit_date', { ascending: false }).limit(2000)
    if (vErr) throw vErr
    const visits = (visitRows || []) as Array<{
        id: string; campaign_id: string; account_manager_user_id: string; shop_id: string;
        visit_date: string; notes: string | null; created_at: string;
    }>

    if (visits.length === 0) {
        return emptyDataset(windowDays, dateFrom, dateTo, 'No official visits found for the selected filters.')
    }

    const shopIds = Array.from(new Set(visits.map((v) => v.shop_id).filter(Boolean)))
    const amIds = Array.from(new Set(visits.map((v) => v.account_manager_user_id).filter(Boolean)))

    // 3) Lookup shops + AMs in parallel
    const [shopRes, amRes] = await Promise.all([
        shopIds.length
            ? supa.from('organizations').select('id, org_name, branch, org_code, city, state_id, states:state_id(state_name)').in('id', shopIds)
            : Promise.resolve({ data: [], error: null }),
        amIds.length
            ? supa.from('users').select('id, full_name').in('id', amIds)
            : Promise.resolve({ data: [], error: null }),
    ])

    const shopsById = new Map<string, { id: string; org_name: string; branch?: string | null; code?: string | null; state_name?: string | null; state_id?: string | null; city?: string | null }>(
        ((shopRes.data || []) as any[]).map((s) => [s.id, {
            id: s.id,
            org_name: s.org_name,
            branch: s.branch,
            code: s.org_code ?? null,
            state_name: s.states?.state_name ?? null,
            state_id: s.state_id ?? null,
            city: s.city ?? null,
        }])
    )
    const amsById = new Map<string, string>(((amRes.data || []) as any[]).map((u) => [u.id, u.full_name || '—']))

    // Apply region filter (state_id) by dropping unmatched visits
    let filteredVisits = visits
    if (regionStateId) {
        filteredVisits = visits.filter((v) => shopsById.get(v.shop_id)?.state_id === regionStateId)
        if (filteredVisits.length === 0) {
            return emptyDataset(windowDays, dateFrom, dateTo, 'No visits matched the selected region.')
        }
    }

    // 4) Determine widest scan window we need from consumer_qr_scans
    const visitDates = filteredVisits.map((v) => v.visit_date)
    const minVisit = visitDates.reduce((a, b) => (a < b ? a : b))
    const maxVisit = visitDates.reduce((a, b) => (a > b ? a : b))
    const fetchFrom = addDays(minVisit, -windowDays)
    const fetchTo = addDays(maxVisit, windowDays + 1) // inclusive end

    const targetShopIds = Array.from(new Set(filteredVisits.map((v) => v.shop_id)))

    // 5) Bulk fetch scan rows for the relevant shops + range. Chunk by shop ids if needed.
    type ScanRow = { id: string; shop_id: string; scanned_at: string }
    const scanRows: ScanRow[] = []
    const chunkSize = 200
    let missingNote: string | null = null
    try {
        for (let i = 0; i < targetShopIds.length; i += chunkSize) {
            const chunk = targetShopIds.slice(i, i + chunkSize)
            const { data, error } = await supa
                .from('consumer_qr_scans')
                .select('id, shop_id, scanned_at')
                .in('shop_id', chunk)
                .gte('scanned_at', `${fetchFrom}T00:00:00`)
                .lte('scanned_at', `${fetchTo}T23:59:59.999`)
                .not('shop_id', 'is', null)
                .limit(50000)
            if (error) throw error
            if (data) scanRows.push(...(data as ScanRow[]))
        }
    } catch (err) {
        console.warn('[postVisitImpact] consumer_qr_scans fetch failed; results will be empty for scans', err)
        missingNote = 'Consumer QR scan data could not be loaded — before/after scan counts may show zero.'
    }

    // Group scans by shop_id sorted by time for fast bucketization.
    const scansByShop = new Map<string, ScanRow[]>()
    for (const s of scanRows) {
        if (!s.shop_id || !s.scanned_at) continue
        const list = scansByShop.get(s.shop_id) || []
        list.push(s)
        scansByShop.set(s.shop_id, list)
    }
    for (const list of scansByShop.values()) {
        list.sort((a, b) => a.scanned_at.localeCompare(b.scanned_at))
    }

    const now = new Date()
    const todayIso = isoDate(now)

    const rows: VisitImpactRow[] = filteredVisits.map((v) => {
        const shop = shopsById.get(v.shop_id)
        const shopScans = scansByShop.get(v.shop_id) || []
        const anchor = new Date(v.visit_date + 'T00:00:00Z')
        const beforeStart = new Date(anchor); beforeStart.setUTCDate(beforeStart.getUTCDate() - windowDays)
        const afterEnd = new Date(anchor); afterEnd.setUTCDate(afterEnd.getUTCDate() + windowDays); afterEnd.setUTCHours(23, 59, 59, 999)

        let before = 0
        let after = 0
        const daily_before: { day: number; count: number }[] = []
        const daily_after: { day: number; count: number }[] = []
        for (let i = 1; i <= windowDays; i++) { daily_before.push({ day: -i, count: 0 }); daily_after.push({ day: i, count: 0 }) }
        const beforeMap = new Map(daily_before.map((d) => [d.day, d]))
        const afterMap = new Map(daily_after.map((d) => [d.day, d]))

        let lastAfter: string | null = null
        for (const s of shopScans) {
            const t = new Date(s.scanned_at)
            if (t < beforeStart || t > afterEnd) continue
            const diffMs = t.getTime() - anchor.getTime()
            const diffDays = Math.floor(diffMs / 86400000)
            if (diffDays < 0 && diffDays >= -windowDays) {
                before++
                const bucket = beforeMap.get(diffDays)
                if (bucket) bucket.count++
            } else if (diffDays >= 1 && diffDays <= windowDays) {
                after++
                const bucket = afterMap.get(diffDays)
                if (bucket) bucket.count++
                lastAfter = s.scanned_at
            } else if (diffDays === 0) {
                // visit day itself — exclude from before, count toward after if at/after anchor time
                // Treat as part of after period to match "after visit" intent.
                after++
                const bucket = afterMap.get(1)
                if (bucket) bucket.count++
                lastAfter = s.scanned_at
            }
        }

        const status = classifyImpactStatus(before, after)
        const liftPct = computeScanLiftPercent(before, after)
        const ds = daysBetween(v.visit_date, todayIso)

        return {
            visit_id: v.id,
            visit_date: v.visit_date,
            campaign_id: v.campaign_id,
            campaign_name: campaigns.find((c) => c.id === v.campaign_id)?.name || '—',
            account_manager_user_id: v.account_manager_user_id,
            account_manager_name: amsById.get(v.account_manager_user_id) || '—',
            shop_id: v.shop_id,
            shop_name: shop ? `${shop.org_name}${shop.branch ? ` (${shop.branch})` : ''}` : '—',
            shop_code: shop?.code || null,
            shop_region: shop?.state_name || shop?.city || null,
            before_scans: before,
            after_scans: after,
            scan_lift: after - before,
            scan_lift_percent: liftPct,
            status,
            days_since_visit: ds < 0 ? 0 : ds,
            last_scan_after_at: lastAfter,
            daily_before,
            daily_after,
            notes: v.notes,
        }
    })

    const summary = buildSummary(rows)

    // Distinct lookups for filters
    const regionMap = new Map<string, string>()
    for (const s of shopsById.values()) {
        if (s.state_id && s.state_name) regionMap.set(s.state_id, s.state_name)
    }
    const regions = Array.from(regionMap.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    const amList = Array.from(amsById.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))

    return {
        visits: rows,
        summary,
        campaigns,
        accountManagers: amList,
        regions,
        windowDays,
        dateFrom,
        dateTo,
        missingDataNote: missingNote,
    }
}

function emptyDataset(windowDays: ImpactWindow, dateFrom: string | null, dateTo: string | null, note: string | null): ImpactDataset {
    return {
        visits: [],
        summary: {
            visited_shops: 0, improved_shops: 0, maintained_shops: 0, dropped_shops: 0,
            newly_activated_shops: 0, no_response_shops: 0,
            total_before_scans: 0, total_after_scans: 0,
            avg_scan_lift_percent: null, median_scan_lift_percent: null,
            visit_to_scan_conversion: 0,
        },
        campaigns: [], accountManagers: [], regions: [],
        windowDays, dateFrom, dateTo,
        missingDataNote: note,
    }
}

export function buildSummary(rows: VisitImpactRow[]): ImpactSummary {
    // shop-level aggregation: a shop visited multiple times still counts once for shop-based metrics
    const shopLatest = new Map<string, VisitImpactRow>()
    for (const r of rows) {
        const existing = shopLatest.get(r.shop_id)
        if (!existing || existing.visit_date < r.visit_date) shopLatest.set(r.shop_id, r)
    }
    const shopRows = Array.from(shopLatest.values())

    const visited_shops = shopRows.length
    const improved_shops = shopRows.filter((r) => r.status === 'improved').length
    const maintained_shops = shopRows.filter((r) => r.status === 'maintained').length
    const dropped_shops = shopRows.filter((r) => r.status === 'dropped').length
    const newly_activated_shops = shopRows.filter((r) => r.status === 'newly_activated').length
    const no_response_shops = shopRows.filter((r) => r.status === 'no_response').length

    const total_before_scans = shopRows.reduce((a, r) => a + r.before_scans, 0)
    const total_after_scans = shopRows.reduce((a, r) => a + r.after_scans, 0)

    const liftPcts = shopRows.map((r) => r.scan_lift_percent).filter((v): v is number => v !== null && Number.isFinite(v))
    const avg = liftPcts.length ? liftPcts.reduce((a, b) => a + b, 0) / liftPcts.length : null

    const shopsWithAfter = shopRows.filter((r) => r.after_scans > 0).length

    return {
        visited_shops,
        improved_shops,
        maintained_shops,
        dropped_shops,
        newly_activated_shops,
        no_response_shops,
        total_before_scans,
        total_after_scans,
        avg_scan_lift_percent: avg,
        median_scan_lift_percent: median(liftPcts),
        visit_to_scan_conversion: visited_shops > 0 ? shopsWithAfter / visited_shops : 0,
    }
}
