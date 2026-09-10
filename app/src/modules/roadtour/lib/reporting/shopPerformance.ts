// Shop Performance — the continuous monthly view of a shop, independent of visits.
//
// AM Performance answers "did this intervention work?" with a 7-day window around
// one visit. This answers "how is this shop trending?" by comparing whole calendar
// months of successful product QR scans. The two deliberately disagree: a month
// with no RoadTour visit at all still has shop performance.
//
// Totals are raw monthly counts. They are NOT normalised per day — a 28-day and a
// 31-day month with the same total are Maintained, because the business question
// is "did the shop do more or less business through the QR", not "per day".
//
// The system presents the trend; management decides Monitor, Contact, Revisit or
// No Action. A decline never auto-creates work.

export type ShopPerformanceState =
    | 'improved'
    | 'maintained'
    | 'declined'
    | 'newly_active'
    | 'no_activity'

export const SHOP_PERFORMANCE_STATE_LABEL: Record<ShopPerformanceState, string> = {
    improved: 'Improved',
    maintained: 'Maintained',
    declined: 'Declined',
    newly_active: 'Newly Active',
    no_activity: 'No Activity',
}

/**
 * What the metric counts, in the words used in the UI.
 *
 * Only scans carrying a `shop_id` can be attributed to a shop, and in this data
 * a shop is recorded only when a claim actually completes. The metric is
 * therefore successful, shop-attributed product QR scans — not raw page opens or
 * scan attempts, which carry no shop at all.
 */
export const SHOP_PERFORMANCE_METRIC_LABEL = 'Successful Product QR Scans'
export const SHOP_PERFORMANCE_METHOD_NOTE =
    'Successful Product QR Scans for the selected month compared with the previous month. Manual point adjustments are excluded.'

export interface ShopMonthlyScanTotal {
    shopId: string
    /** `YYYY-MM` in the Malaysia reporting zone. */
    monthKey: string
    scans: number
}

export interface ShopPerformanceRow {
    shopId: string
    shopName: string
    shopNamePrimary: string
    shopBranchLabel: string | null
    shopCode: string | null
    region: string | null
    shopStateId: string | null
    currentScans: number
    previousScans: number
    delta: number
    /** Percentage change; null when there is no baseline to divide by. */
    changePercent: number | null
    state: ShopPerformanceState
    /** Oldest → newest monthly totals for the sparkline. */
    trail: Array<{ monthKey: string; scans: number }>
}

/**
 * Deterministic state for one shop-month.
 *
 * Order matters: the two zero cases are named states in their own right, so they
 * are decided before the ordinary comparison. A shop with no scans in either
 * month has nothing to report and stays `no_activity`.
 */
export function classifyShopPerformance(current: number, previous: number): ShopPerformanceState {
    if (previous <= 0 && current > 0) return 'newly_active'
    if (previous > 0 && current <= 0) return 'no_activity'
    if (current > previous) return 'improved'
    if (current < previous) return 'declined'
    if (current === 0) return 'no_activity'
    return 'maintained'
}

/** Percentage change against the previous month; null when there is no baseline. */
export function computeMonthlyChangePercent(current: number, previous: number): number | null {
    if (previous <= 0) return null
    return ((current - previous) / previous) * 100
}

/**
 * Collapse per-shop monthly totals into one row per shop for the selected month.
 *
 * A shop absent from `totals` for a month scanned zero times that month; it must
 * still produce a row, otherwise a shop that went quiet — the case management most
 * needs to see — would silently vanish from the report.
 */
export function buildShopPerformanceRows(input: {
    totals: ShopMonthlyScanTotal[]
    monthKey: string
    previousMonthKey: string
    trailMonthKeys: string[]
    shops: Map<string, {
        shopName: string
        shopNamePrimary: string
        shopBranchLabel: string | null
        shopCode: string | null
        region: string | null
        shopStateId: string | null
    }>
}): ShopPerformanceRow[] {
    const byShop = new Map<string, Map<string, number>>()
    for (const total of input.totals) {
        const months = byShop.get(total.shopId) || new Map<string, number>()
        months.set(total.monthKey, (months.get(total.monthKey) || 0) + total.scans)
        byShop.set(total.shopId, months)
    }

    const rows: ShopPerformanceRow[] = []
    for (const [shopId, months] of byShop) {
        const shop = input.shops.get(shopId)
        if (!shop) continue

        const currentScans = months.get(input.monthKey) || 0
        const previousScans = months.get(input.previousMonthKey) || 0

        // A shop that has never scanned in either month is not news.
        if (currentScans === 0 && previousScans === 0) continue

        rows.push({
            shopId,
            shopName: shop.shopName,
            shopNamePrimary: shop.shopNamePrimary,
            shopBranchLabel: shop.shopBranchLabel,
            shopCode: shop.shopCode,
            region: shop.region,
            shopStateId: shop.shopStateId,
            currentScans,
            previousScans,
            delta: currentScans - previousScans,
            changePercent: computeMonthlyChangePercent(currentScans, previousScans),
            state: classifyShopPerformance(currentScans, previousScans),
            trail: input.trailMonthKeys.map((monthKey) => ({
                monthKey,
                scans: months.get(monthKey) || 0,
            })),
        })
    }

    return rows.sort((a, b) => a.shopName.localeCompare(b.shopName))
}

export interface ShopPerformanceSummary {
    shopsReported: number
    totalCurrentScans: number
    totalPreviousScans: number
    totalDelta: number
    stateCounts: Record<ShopPerformanceState, number>
}

export function buildShopPerformanceSummary(rows: ShopPerformanceRow[]): ShopPerformanceSummary {
    const stateCounts: Record<ShopPerformanceState, number> = {
        improved: 0, maintained: 0, declined: 0, newly_active: 0, no_activity: 0,
    }
    let totalCurrentScans = 0
    let totalPreviousScans = 0

    for (const row of rows) {
        stateCounts[row.state] += 1
        totalCurrentScans += row.currentScans
        totalPreviousScans += row.previousScans
    }

    return {
        shopsReported: rows.length,
        totalCurrentScans,
        totalPreviousScans,
        totalDelta: totalCurrentScans - totalPreviousScans,
        stateCounts,
    }
}

/** Shops management may want to act on. Presented, never auto-actioned. */
export function needsAttention(row: ShopPerformanceRow): boolean {
    return row.state === 'declined' || row.state === 'no_activity'
}
