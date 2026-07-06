/**
 * Shared RoadTour Monthly KPI helpers (client + server safe).
 *
 * KPI months always use calendar month boundaries in Malaysia time (+08:00).
 * There is intentionally no From/To date support in this module.
 */

export type KpiCycleStatus = 'draft' | 'active' | 'closed'
export type KpiReportingScope = 'all_campaigns' | 'selected_campaigns'
export type KpiRuleAppliesTo = 'all_ams' | 'team_leader' | 'specific_team'
export type KpiBonusType = 'cash' | 'other'
export type KpiTeamStatus = 'draft' | 'active'
export type KpiPerformanceStatus = 'achieved' | 'on_track' | 'at_risk' | 'needs_focus'

export const KPI_TZ_OFFSET = '+08:00'

/** Team-level status thresholds (defaults; percent of target). */
export const KPI_TEAM_ON_TRACK_THRESHOLD = 85
/** AM-level "needs focus" threshold (below this an AM is flagged). */
export const KPI_AM_NEEDS_FOCUS_THRESHOLD = 70

export interface KpiMonthPeriod {
    /** 'YYYY-MM' */
    kpiMonth: string
    /** 'YYYY-MM-01' */
    periodStart: string
    /** 'YYYY-MM-<last day>' */
    periodEnd: string
    /** Inclusive ISO timestamp of the first instant of the month in MYT. */
    scanTimeFrom: string
    /** Exclusive ISO timestamp of the first instant of the next month in MYT. */
    scanTimeToExclusive: string
    /** e.g. '1 Jun 2026 – 30 Jun 2026' */
    label: string
}

const MONTH_RE = /^(\d{4})-(\d{2})$/

export function isValidKpiMonth(value: string): boolean {
    const m = MONTH_RE.exec(value)
    if (!m) return false
    const month = Number(m[2])
    return month >= 1 && month <= 12
}

const pad = (n: number) => String(n).padStart(2, '0')

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Derive the auto period for a KPI month ('YYYY-MM').
 * June 2026 → 1 Jun 2026 to 30 Jun 2026; handles month-end (incl. leap Feb).
 */
export function deriveKpiMonthPeriod(kpiMonth: string): KpiMonthPeriod {
    if (!isValidKpiMonth(kpiMonth)) throw new Error(`Invalid KPI month: ${kpiMonth}`)
    const [yearStr, monthStr] = kpiMonth.split('-')
    const year = Number(yearStr)
    const month = Number(monthStr)
    // Day 0 of next month = last day of this month.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const nextYear = month === 12 ? year + 1 : year
    const nextMonth = month === 12 ? 1 : month + 1
    return {
        kpiMonth,
        periodStart: `${kpiMonth}-01`,
        periodEnd: `${kpiMonth}-${pad(lastDay)}`,
        scanTimeFrom: `${kpiMonth}-01T00:00:00${KPI_TZ_OFFSET}`,
        scanTimeToExclusive: `${nextYear}-${pad(nextMonth)}-01T00:00:00${KPI_TZ_OFFSET}`,
        label: `1 ${SHORT_MONTHS[month - 1]} ${year} – ${lastDay} ${SHORT_MONTHS[month - 1]} ${year}`,
    }
}

/** 'YYYY-MM' for the month before the given KPI month. */
export function previousKpiMonth(kpiMonth: string): string {
    if (!isValidKpiMonth(kpiMonth)) throw new Error(`Invalid KPI month: ${kpiMonth}`)
    const [yearStr, monthStr] = kpiMonth.split('-')
    const year = Number(yearStr)
    const month = Number(monthStr)
    return month === 1 ? `${year - 1}-12` : `${yearStr}-${pad(month - 1)}`
}

/** 'June 2026' style label. */
export function formatKpiMonthLabel(kpiMonth: string): string {
    if (!isValidKpiMonth(kpiMonth)) return kpiMonth
    const [yearStr, monthStr] = kpiMonth.split('-')
    const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    return `${names[Number(monthStr) - 1]} ${yearStr}`
}

/** kpi_month date column value ('YYYY-MM-01') → 'YYYY-MM'. */
export function kpiMonthFromDate(value: string): string {
    return value.slice(0, 7)
}

/**
 * Even auto-distribution of a team target across members.
 * Remainder scans go to the first members so the total always matches.
 */
export function autoDistributeTarget(teamTarget: number, memberCount: number): number[] {
    if (memberCount <= 0) return []
    const base = Math.floor(teamTarget / memberCount)
    const remainder = teamTarget - base * memberCount
    return Array.from({ length: memberCount }, (_, i) => base + (i < remainder ? 1 : 0))
}

export function achievementPercent(actual: number, target: number): number {
    if (target <= 0) return 0
    return (actual / target) * 100
}

/** Team status: Achieved ≥100%, On Track ≥85% (default), otherwise At Risk. */
export function teamPerformanceStatus(percent: number, onTrackThreshold = KPI_TEAM_ON_TRACK_THRESHOLD): KpiPerformanceStatus {
    if (percent >= 100) return 'achieved'
    if (percent >= onTrackThreshold) return 'on_track'
    return 'at_risk'
}

/** AM status adds a Needs Focus band below the At Risk band. */
export function amPerformanceStatus(
    percent: number,
    onTrackThreshold = KPI_TEAM_ON_TRACK_THRESHOLD,
    needsFocusThreshold = KPI_AM_NEEDS_FOCUS_THRESHOLD,
): KpiPerformanceStatus {
    if (percent >= 100) return 'achieved'
    if (percent >= onTrackThreshold) return 'on_track'
    if (percent >= needsFocusThreshold) return 'at_risk'
    return 'needs_focus'
}

export interface KpiIncentiveRuleLike {
    applies_to: KpiRuleAppliesTo
    achievement_threshold_percent: number
    incentive_amount: number
    status: string
    team_id?: string | null
}

/**
 * AM incentive: tiered — the highest-threshold active rule the AM has met wins
 * (e.g. Base 100% = RM200, Exceed 120% = RM300 → an AM at 125% earns RM300).
 * Rules scoped to a specific team only apply to that team's members.
 */
export function computeAmIncentive(rules: KpiIncentiveRuleLike[], amPercent: number, teamId?: string | null): number {
    let best: KpiIncentiveRuleLike | null = null
    for (const rule of rules) {
        if (rule.status !== 'active') continue
        if (rule.applies_to === 'team_leader') continue
        if (rule.applies_to === 'specific_team' && rule.team_id !== teamId) continue
        if (amPercent < rule.achievement_threshold_percent) continue
        if (!best || rule.achievement_threshold_percent > best.achievement_threshold_percent) best = rule
    }
    return best ? Number(best.incentive_amount) : 0
}

/**
 * Team leader bonus: sum of active team_leader rules whose threshold the TEAM
 * achievement meets (team-scoped leader rules apply to that team only).
 */
export function computeLeaderBonus(rules: KpiIncentiveRuleLike[], teamPercent: number, teamId?: string | null): number {
    let total = 0
    for (const rule of rules) {
        if (rule.status !== 'active') continue
        if (rule.applies_to !== 'team_leader') continue
        if (rule.team_id && rule.team_id !== teamId) continue
        if (teamPercent >= rule.achievement_threshold_percent) total += Number(rule.incentive_amount)
    }
    return total
}

export const KPI_STATUS_LABEL: Record<KpiPerformanceStatus, string> = {
    achieved: 'Achieved',
    on_track: 'On Track',
    at_risk: 'At Risk',
    needs_focus: 'Needs Focus',
}
