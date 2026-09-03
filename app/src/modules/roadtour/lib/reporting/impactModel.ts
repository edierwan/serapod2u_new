// Single classification engine for RoadTour post-visit impact.
//
// Official management window: 7 days before the visit vs 7 days after the visit.
// The selected month decides WHICH visits are in the report; the 7D window decides
// HOW their impact is measured. 3D and 30D exist only as drill-downs.
//
// Observation maturity: a visit younger than a full observation window is
// `pending_observation`. Pending visits are never counted as `no_response` and are
// excluded from response-rate denominators, improved/dropped rates and AM ranking.

export const OFFICIAL_IMPACT_WINDOW_DAYS = 7
export const DRILLDOWN_IMPACT_WINDOWS = [3, 7, 30] as const
export const IMPACT_METHOD_NOTE = 'Impact measured using 7 days before vs 7 days after each visit.'

export const DAY_MS = 86_400_000

export type ImpactWindowDays = (typeof DRILLDOWN_IMPACT_WINDOWS)[number]

export type ShopOutcome =
    | 'improved'
    | 'newly_activated'
    | 'maintained'
    | 'dropped'
    | 'no_response'
    | 'pending_observation'

export const OUTCOME_LABEL: Record<ShopOutcome, string> = {
    improved: 'Improved',
    newly_activated: 'Newly Activated',
    maintained: 'Maintained',
    dropped: 'Dropped',
    no_response: 'No Response',
    pending_observation: 'Pending Observation',
}

/** Outcomes that only exist once the observation window has fully elapsed. */
export const MATURED_OUTCOMES: ShopOutcome[] = [
    'improved', 'newly_activated', 'maintained', 'dropped', 'no_response',
]

export function normalizeImpactWindowDays(value: unknown): ImpactWindowDays {
    const parsed = Number(value)
    return (DRILLDOWN_IMPACT_WINDOWS as readonly number[]).includes(parsed)
        ? (parsed as ImpactWindowDays)
        : OFFICIAL_IMPACT_WINDOW_DAYS
}

/** Instant (ms) at which a visit's observation window is complete. */
export function observationMaturesAt(anchorIso: string, windowDays: number): number {
    return new Date(anchorIso).getTime() + windowDays * DAY_MS
}

/**
 * A visit is mature only after `windowDays` COMPLETE days have elapsed since the
 * official visit event. Day 6 is still pending; day 7 is mature.
 */
export function isObservationMature(anchorIso: string, windowDays: number, now: Date = new Date()): boolean {
    return now.getTime() >= observationMaturesAt(anchorIso, windowDays)
}

/** Whole days elapsed since the visit anchor (never negative). */
export function daysSinceVisit(anchorIso: string, now: Date = new Date()): number {
    const elapsed = now.getTime() - new Date(anchorIso).getTime()
    return elapsed <= 0 ? 0 : Math.floor(elapsed / DAY_MS)
}

/**
 * Deterministic outcome for one visit.
 *
 * `newly_activated`  zero valid scans before, at least one additional scan after
 * `improved`         after > before
 * `maintained`       after === before and both > 0
 * `dropped`          after < before
 * `no_response`      mature window with zero valid after scans
 * `pending_observation` the full window has not elapsed yet
 */
export function classifyShopOutcome(input: {
    beforeScans: number
    afterScans: number
    matured: boolean
}): ShopOutcome {
    if (!input.matured) return 'pending_observation'
    if (input.afterScans <= 0) return 'no_response'
    if (input.beforeScans <= 0) return 'newly_activated'
    if (input.afterScans > input.beforeScans) return 'improved'
    if (input.afterScans < input.beforeScans) return 'dropped'
    return 'maintained'
}

/**
 * Percentage change in scan volume. `0 → positive` deliberately returns null:
 * that case is reported as `Newly Activated`, never as an infinite lift.
 */
export function computeScanLiftPercent(beforeScans: number, afterScans: number): number | null {
    if (beforeScans > 0) return ((afterScans - beforeScans) / beforeScans) * 100
    return null
}

export function medianOf(values: number[]): number | null {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle]
}

/** A responding shop = matured observation with at least one additional valid scan. */
export function hasResponded(input: { matured: boolean; afterScans: number }): boolean {
    return input.matured && input.afterScans > 0
}

export function formatOutcome(outcome: ShopOutcome): string {
    return OUTCOME_LABEL[outcome]
}

export function formatImpactWindowLabel(windowDays: number): string {
    return `${windowDays}D`
}
