/**
 * QR Engagement Trend (Journey Builder dashboard).
 *
 * Aggregation happens in Postgres (get_journey_engagement_trend, migration
 * 20260921130000_journey_engagement_trend.sql). This module only resolves the
 * selected range into Asia/Kuala_Lumpur calendar dates and shapes the RPC rows
 * into a gap-free daily series.
 *
 * Semantics (same as the Total Scans KPI and the journey card "Scanned"):
 *   scans    = QR codes whose first consumer scan (qr_codes.first_consumer_scan_at)
 *              falls on the MYT day. Unique codes, re-scans are not re-counted.
 *   redeemed = QR codes redeemed (qr_codes.redeemed_at, is_redeemed) on the MYT day.
 *   failed   = not tracked anywhere; deliberately absent.
 */

export const TREND_TIME_ZONE = 'Asia/Kuala_Lumpur'

export const TREND_RANGES = ['7d', '30d', '3m', '6m', 'lastMonth', '12m'] as const
export type TrendRange = typeof TREND_RANGES[number]

export interface TrendPoint {
    date: string
    scans: number
    redeemed: number
}

export interface TrendWindow {
    range: TrendRange
    startDate: string
    endDate: string
}

export function isTrendRange(value: unknown): value is TrendRange {
    return typeof value === 'string' && (TREND_RANGES as readonly string[]).includes(value)
}

/** Malaysia calendar date (YYYY-MM-DD) of an instant. */
export function malaysiaDateKey(instant: Date | string): string {
    const date = typeof instant === 'string' ? new Date(instant) : instant
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TREND_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date)
}

function parseDateKey(key: string): Date {
    return new Date(`${key}T00:00:00Z`)
}

function toDateKey(date: Date): string {
    return date.toISOString().slice(0, 10)
}

export function addTrendDays(key: string, days: number): string {
    const d = parseDateKey(key)
    d.setUTCDate(d.getUTCDate() + days)
    return toDateKey(d)
}

/** Subtract calendar months, clamping to the last day of the target month. */
function subtractMonths(key: string, months: number): string {
    const [y, m, d] = key.split('-').map(Number)
    const target = new Date(Date.UTC(y, m - 1 - months, 1))
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
    target.setUTCDate(Math.min(d, lastDay))
    return toDateKey(target)
}

/**
 * Inclusive MYT date window for a range, anchored on "today" in Malaysia.
 * Month-based ranges start the day after the same date N months ago, so
 * "Last 3 Months" on 21 Sep covers 22 Jun .. 21 Sep.
 */
export function resolveTrendWindow(range: TrendRange, now: Date = new Date()): TrendWindow {
    const today = malaysiaDateKey(now)
    switch (range) {
        case '7d':
            return { range, startDate: addTrendDays(today, -6), endDate: today }
        case '30d':
            return { range, startDate: addTrendDays(today, -29), endDate: today }
        case '3m':
            return { range, startDate: addTrendDays(subtractMonths(today, 3), 1), endDate: today }
        case '6m':
            return { range, startDate: addTrendDays(subtractMonths(today, 6), 1), endDate: today }
        case '12m':
            return { range, startDate: addTrendDays(subtractMonths(today, 12), 1), endDate: today }
        case 'lastMonth': {
            const firstOfThisMonth = `${today.slice(0, 7)}-01`
            const endDate = addTrendDays(firstOfThisMonth, -1)
            return { range, startDate: `${endDate.slice(0, 7)}-01`, endDate }
        }
    }
}

/** Fill every day of the window, taking counts from the RPC rows. */
export function buildTrendSeries(
    rows: { day: string; scans: number | string | null; redeemed: number | string | null }[] | null | undefined,
    startDate: string,
    endDate: string,
): TrendPoint[] {
    const byDay = new Map<string, { scans: number; redeemed: number }>()
    for (const row of rows || []) {
        if (!row?.day) continue
        byDay.set(String(row.day).slice(0, 10), {
            scans: Number(row.scans || 0),
            redeemed: Number(row.redeemed || 0),
        })
    }

    const series: TrendPoint[] = []
    for (let key = startDate; key <= endDate; key = addTrendDays(key, 1)) {
        const hit = byDay.get(key)
        series.push({ date: key, scans: hit?.scans ?? 0, redeemed: hit?.redeemed ?? 0 })
    }
    return series
}
