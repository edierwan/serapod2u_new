import 'server-only'

// Server-side loader for RoadTour Shop Performance.
//
// Runs on the server for the same reason the AM reporting loader does: shop names
// live in `organizations`, which is RLS-scoped to the viewer's own organization,
// so reading them from the browser silently drops rows.
//
// Scope of the metric, decided from the production data rather than assumed:
//   * `shop_id IS NOT NULL` — only scans that can actually be attributed to a
//     shop. Consumer-lane rows carry no shop and are never invented into one.
//   * `is_manual_adjustment = false` — admin point corrections are not shop
//     activity. AM Performance now applies the same exclusion.
//   * No `collected_points` filter: every shop-attributed row already has it
//     true, so the filter would be a no-op that only obscures the query.

import {
    buildShopPerformanceRows,
    buildShopPerformanceSummary,
    type ShopMonthlyScanTotal,
    type ShopPerformanceRow,
    type ShopPerformanceSummary,
} from '@/modules/roadtour/lib/reporting/shopPerformance'
import {
    REPORTING_TIME_ZONE,
    reportingCutoffDate,
    resolveReportingMonth,
    shiftMonthKey,
} from '@/modules/roadtour/lib/reporting/month'
import { resolveShopDisplay } from '@/modules/roadtour/lib/reporting/shopDisplay'
import type { ReportingFilterOption } from '@/modules/roadtour/lib/reporting/types'

/** Months of history behind the selected month, for the trend sparkline. */
export const SHOP_PERFORMANCE_TRAIL_MONTHS = 6
const SCAN_PAGE_SIZE = 1000
const MAX_SCAN_PAGES = 400

export interface ShopPerformanceDatasetMeta {
    monthKey: string
    monthLabel: string
    previousMonthKey: string
    previousMonthLabel: string
    isCurrentMonth: boolean
    cutoffDate: string
    trailMonthKeys: string[]
    generatedAt: string
    warnings: string[]
}

export interface ShopPerformanceDataset {
    rows: ShopPerformanceRow[]
    summary: ShopPerformanceSummary
    regions: ReportingFilterOption[]
    meta: ShopPerformanceDatasetMeta
}

export interface LoadShopPerformanceParams {
    admin: any
    orgId: string
    monthKey: string
    regionStateId?: string | null
    now?: Date
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

/** `YYYY-MM` of an instant in the Malaysia reporting zone. */
function reportingMonthKeyOf(iso: string): string {
    const formatted = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', timeZone: REPORTING_TIME_ZONE,
    }).format(new Date(iso))
    return formatted.slice(0, 7)
}

export async function loadShopPerformanceDataset(
    params: LoadShopPerformanceParams,
): Promise<ShopPerformanceDataset> {
    const now = params.now ?? new Date()
    const month = resolveReportingMonth(params.monthKey, now)
    const previousMonth = resolveReportingMonth(shiftMonthKey(month.key, -1), now)
    const warnings: string[] = []

    // Oldest → newest, ending on the selected month.
    const trailMonthKeys: string[] = []
    for (let offset = SHOP_PERFORMANCE_TRAIL_MONTHS - 1; offset >= 0; offset -= 1) {
        trailMonthKeys.push(shiftMonthKey(month.key, -offset))
    }
    const windowStart = resolveReportingMonth(trailMonthKeys[0], now)

    const emptyMeta = (): ShopPerformanceDatasetMeta => ({
        monthKey: month.key,
        monthLabel: month.label,
        previousMonthKey: previousMonth.key,
        previousMonthLabel: previousMonth.label,
        isCurrentMonth: month.isCurrentMonth,
        cutoffDate: reportingCutoffDate(month, now),
        trailMonthKeys,
        generatedAt: now.toISOString(),
        warnings,
    })

    // ── The RoadTour cohort ─────────────────────────────────────────────────
    //
    // Shops are scoped by the campaigns this organization owns, not by
    // `organizations.parent_org_id` — a visited shop's parent is its own retail
    // group, not the RoadTour organization, so scoping on it returns nothing.
    // The cohort is "every shop RoadTour has actually visited", which is also the
    // set management wants to keep watching after the visit.
    const { data: campaignRows, error: campaignError } = await params.admin
        .from('roadtour_campaigns')
        .select('id')
        .eq('org_id', params.orgId)
    if (campaignError) throw campaignError

    const campaignIds = ((campaignRows || []) as any[]).map((row) => row.id).filter(Boolean)
    if (campaignIds.length === 0) {
        warnings.push('No RoadTour campaigns exist for this organization yet.')
        return {
            rows: [],
            summary: buildShopPerformanceSummary([]),
            regions: [],
            meta: emptyMeta(),
        }
    }

    const { data: visitShopRows, error: visitShopError } = await params.admin
        .from('roadtour_official_visits')
        .select('shop_id')
        .in('campaign_id', campaignIds)
        .in('visit_status', ['official', 'manual'])
    if (visitShopError) throw visitShopError

    const cohortShopIds = Array.from(new Set(
        ((visitShopRows || []) as any[]).map((row) => row.shop_id).filter(Boolean),
    )) as string[]

    if (cohortShopIds.length === 0) {
        warnings.push('No shops have been visited by RoadTour yet.')
        return {
            rows: [],
            summary: buildShopPerformanceSummary([]),
            regions: [],
            meta: emptyMeta(),
        }
    }

    const shopRows: any[] = []
    for (let index = 0; index < cohortShopIds.length; index += 150) {
        const chunk = cohortShopIds.slice(index, index + 150)
        const { data, error: shopError } = await params.admin
            .from('organizations')
            .select('id, org_name, branch, org_code, city, state_id, states:state_id(state_name)')
            .in('id', chunk)
        if (shopError) throw shopError
        shopRows.push(...((data || []) as any[]))
    }

    const shops = new Map<string, {
        shopName: string
        shopNamePrimary: string
        shopBranchLabel: string | null
        shopCode: string | null
        region: string | null
        shopStateId: string | null
    }>()
    const regionOptions = new Map<string, string>()

    for (const row of ((shopRows || []) as any[])) {
        const stateName = normalizeText(
            Array.isArray(row.states) ? row.states[0]?.state_name : row.states?.state_name,
        )
        const display = resolveShopDisplay({
            shopName: normalizeText(row.org_name),
            branch: normalizeText(row.branch),
        })
        shops.set(row.id, {
            shopName: display.fullLabel,
            shopNamePrimary: display.primaryName,
            shopBranchLabel: display.branchLabel,
            shopCode: normalizeText(row.org_code),
            region: stateName ?? normalizeText(row.city),
            shopStateId: row.state_id ?? null,
        })
        if (row.state_id && stateName) regionOptions.set(row.state_id, stateName)
    }

    if (shops.size === 0) {
        warnings.push('Shop details could not be loaded for this report.')
        return {
            rows: [],
            summary: buildShopPerformanceSummary([]),
            regions: [],
            meta: emptyMeta(),
        }
    }

    const scopedShopIds = params.regionStateId
        ? Array.from(shops.entries())
            .filter(([, shop]) => shop.shopStateId === params.regionStateId)
            .map(([id]) => id)
        : Array.from(shops.keys())

    if (scopedShopIds.length === 0) {
        return {
            rows: [],
            summary: buildShopPerformanceSummary([]),
            regions: Array.from(regionOptions.entries())
                .map(([id, name]) => ({ id, name }))
                .sort((a, b) => a.name.localeCompare(b.name)),
            meta: emptyMeta(),
        }
    }

    // ── Monthly successful product-QR scan totals ───────────────────────────
    //
    // Aggregated here rather than in SQL because PostgREST cannot group by a
    // computed month. Paged so a busy organization cannot silently truncate:
    // a short page is the only reliable end-of-data signal.
    const scanCounts = new Map<string, Map<string, number>>()
    const scopedShopIdSet = new Set(scopedShopIds)

    try {
        for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
            const from = page * SCAN_PAGE_SIZE
            const { data, error } = await params.admin
                .from('consumer_qr_scans')
                .select('shop_id, scanned_at')
                .not('shop_id', 'is', null)
                .eq('is_manual_adjustment', false)
                .gte('scanned_at', windowStart.startUtc)
                .lt('scanned_at', month.endUtc)
                .order('scanned_at', { ascending: true })
                .range(from, from + SCAN_PAGE_SIZE - 1)
            if (error) throw error

            const rows = (data || []) as Array<{ shop_id: string; scanned_at: string }>
            for (const row of rows) {
                if (!row.shop_id || !row.scanned_at) continue
                if (!scopedShopIdSet.has(row.shop_id)) continue
                const monthKey = reportingMonthKeyOf(row.scanned_at)
                const months = scanCounts.get(row.shop_id) || new Map<string, number>()
                months.set(monthKey, (months.get(monthKey) || 0) + 1)
                scanCounts.set(row.shop_id, months)
            }

            if (rows.length < SCAN_PAGE_SIZE) break
            if (page === MAX_SCAN_PAGES - 1) {
                warnings.push('Product QR scan history was truncated — totals for the earliest months may be incomplete.')
            }
        }
    } catch (error) {
        console.warn('[roadtour-shop-performance] consumer_qr_scans fetch failed', error)
        warnings.push('Product QR scan data could not be loaded — monthly totals are unavailable.')
    }

    const totals: ShopMonthlyScanTotal[] = []
    for (const [shopId, months] of scanCounts) {
        for (const [monthKey, scans] of months) {
            totals.push({ shopId, monthKey, scans })
        }
    }

    const rows = buildShopPerformanceRows({
        totals,
        monthKey: month.key,
        previousMonthKey: previousMonth.key,
        trailMonthKeys,
        shops,
    })

    return {
        rows,
        summary: buildShopPerformanceSummary(rows),
        regions: Array.from(regionOptions.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        meta: emptyMeta(),
    }
}
