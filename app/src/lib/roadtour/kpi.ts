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

/** 'YYYY-MM' for the current calendar month (server/client local time). */
export function currentKpiMonth(now: Date = new Date()): string {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}

/** Shift a KPI month by `delta` whole months (delta may be negative). */
export function addKpiMonths(kpiMonth: string, delta: number): string {
    if (!isValidKpiMonth(kpiMonth)) throw new Error(`Invalid KPI month: ${kpiMonth}`)
    const [yearStr, monthStr] = kpiMonth.split('-')
    const zeroBased = Number(yearStr) * 12 + (Number(monthStr) - 1) + delta
    const year = Math.floor(zeroBased / 12)
    const month = (zeroBased % 12 + 12) % 12
    return `${year}-${pad(month + 1)}`
}

/** Compare two KPI months: -1 if a<b, 0 if equal, 1 if a>b. */
export function compareKpiMonth(a: string, b: string): number {
    return a === b ? 0 : a < b ? -1 : 1
}

/**
 * True when `month` falls inside a plan's effective window.
 * `to` is inclusive; a null `to` means the plan is open-ended.
 */
export function isMonthInEffectiveRange(month: string, from: string, to: string | null): boolean {
    if (compareKpiMonth(month, from) < 0) return false
    if (to && compareKpiMonth(month, to) > 0) return false
    return true
}

/** Extract 'YYYY-MM' from a 'YYYY-MM-DD' / ISO date string, or null if unparseable. */
export function monthKeyFromDate(dateStr: string | null | undefined): string | null {
    if (!dateStr) return null
    const m = /^(\d{4})-(\d{2})/.exec(String(dateStr))
    if (!m) return null
    const month = Number(m[2])
    return month >= 1 && month <= 12 ? `${m[1]}-${m[2]}` : null
}

/** Inclusive ascending list of KPI months between two 'YYYY-MM' bounds (capped at 60 months). */
export function enumerateMonthRange(from: string, to: string): string[] {
    if (!isValidKpiMonth(from) || !isValidKpiMonth(to)) return []
    const start = compareKpiMonth(from, to) <= 0 ? from : to
    const end = compareKpiMonth(from, to) <= 0 ? to : from
    const months: string[] = []
    let cursor = start
    for (let i = 0; i < 60 && compareKpiMonth(cursor, end) <= 0; i++) {
        months.push(cursor)
        cursor = addKpiMonths(cursor, 1)
    }
    return months
}

/**
 * Effective From Month options for a KPI Plan, ascending.
 *
 * Setting up a plan is a near-term action, so the "from" dropdown is a short
 * list — NOT the full event period (that would surface many irrelevant future
 * months for a long event). Rules (see product spec):
 *  - Always: previous, current and next calendar month.
 *  - If the RoadTour Event starts in a *future* month (beyond next month),
 *    include the event start month so the plan can begin with the event.
 *  - Union in any already-configured plan from-months so existing selections
 *    stay visible even when they fall outside the recent-months window.
 * No long generated future list is produced.
 */
export function deriveEffectiveFromOptions(opts: {
    startDate?: string | null
    configuredMonths?: string[]
    now?: Date
}): string[] {
    const now = opts.now ?? new Date()
    const cur = currentKpiMonth(now)
    const nextMonth = addKpiMonths(cur, 1)
    const startMonth = monthKeyFromDate(opts.startDate)
    const set = new Set<string>([addKpiMonths(cur, -1), cur, nextMonth])

    // Future event start (later than next month) — surface it directly.
    if (startMonth && compareKpiMonth(startMonth, nextMonth) > 0) set.add(startMonth)

    for (const m of opts.configuredMonths || []) {
        if (isValidKpiMonth(m)) set.add(m)
    }

    return [...set].sort((a, b) => compareKpiMonth(a, b))
}

/**
 * Effective To Month options for a KPI Plan, ascending. The UI adds a separate
 * "Open-ended" choice; this returns only the concrete month options. Rules:
 *  - Every option is >= the selected Effective From month.
 *  - Event with an end date → months from `from` up to the event end month
 *    (never beyond the event).
 *  - Open-ended event → just `from` and the following month (no long list).
 *  - Union in configured plan endpoint months (>= from) so existing selections
 *    stay visible.
 */
export function deriveEffectiveToOptions(opts: {
    from: string
    endDate?: string | null
    configuredMonths?: string[]
}): string[] {
    const { from } = opts
    if (!isValidKpiMonth(from)) return []
    const endMonth = monthKeyFromDate(opts.endDate)
    const set = new Set<string>()

    if (endMonth) {
        // Fixed-period event: from → event end (inclusive), capped by the event.
        for (const m of enumerateMonthRange(from, endMonth)) {
            if (compareKpiMonth(m, from) >= 0) set.add(m)
        }
    } else {
        // Open-ended event: keep it short — the from month and the next month.
        set.add(from)
        set.add(addKpiMonths(from, 1))
    }

    for (const m of opts.configuredMonths || []) {
        if (isValidKpiMonth(m) && compareKpiMonth(m, from) >= 0) set.add(m)
    }

    return [...set].sort((a, b) => compareKpiMonth(a, b))
}

/**
 * List the KPI months ('YYYY-MM') a plan covers, newest first.
 * An open-ended plan (null `to`) is capped at the current month so the report
 * month dropdown never shows unconfigured future months.
 */
export function enumeratePlanMonths(from: string, to: string | null, now: Date = new Date()): string[] {
    if (!isValidKpiMonth(from)) return []
    const end = to && isValidKpiMonth(to)
        ? (compareKpiMonth(to, currentKpiMonth(now)) < 0 ? to : currentKpiMonth(now))
        : currentKpiMonth(now)
    // If the plan starts in the future, still surface its first month.
    const stop = compareKpiMonth(end, from) < 0 ? from : end
    const months: string[] = []
    let cursor = stop
    // Guard against pathological ranges (max 240 months / 20 years).
    for (let i = 0; i < 240 && compareKpiMonth(cursor, from) >= 0; i++) {
        months.push(cursor)
        cursor = addKpiMonths(cursor, -1)
    }
    return months
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

/**
 * Rule 4 helper: a team leader must be one of the selected members. Returns the
 * leader id unchanged when they are still a member, otherwise '' ("No leader").
 * Used to reset the leader when they are removed from the member list.
 */
export function resolveLeaderId(leaderId: string, memberIds: string[]): string {
    if (!leaderId) return ''
    return memberIds.includes(leaderId) ? leaderId : ''
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
 * Filter incentive rules to those that apply given the plan's leader-bonus
 * switch. When leader bonus is OFF, team_leader tiers are dropped entirely so a
 * leader earns only their own AM incentive. AM tiers are always kept.
 */
export function effectiveIncentiveRules<T extends { applies_to: KpiRuleAppliesTo }>(
    rules: T[],
    leaderBonusEnabled: boolean,
): T[] {
    if (leaderBonusEnabled) return rules
    return rules.filter((r) => r.applies_to !== 'team_leader')
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
