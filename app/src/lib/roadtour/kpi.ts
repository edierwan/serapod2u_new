/**
 * Shared RoadTour Monthly KPI helpers (client + server safe).
 *
 * KPI months always use calendar month boundaries in Malaysia time (+08:00).
 * There is intentionally no From/To date support in this module.
 */

export type KpiAmIncentiveMode = 'volume_tiers' | 'achievement_tiers'
export type KpiPeriodType = 'weekly' | 'monthly' | 'quarterly' | 'yearly'
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

export interface KpiPeriodWindow extends KpiMonthPeriod {
    periodType: KpiPeriodType
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

function toDateWithOffset(datePart: string): string {
    return `${datePart}T00:00:00${KPI_TZ_OFFSET}`
}

function datePartFromUtcDate(d: Date): string {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function addDaysUtc(d: Date, days: number): Date {
    const copy = new Date(d.getTime())
    copy.setUTCDate(copy.getUTCDate() + days)
    return copy
}

/**
 * Generic KPI reporting window using an anchor month.
 * - weekly: ISO-like Monday-Sunday week containing anchor month's first day
 * - monthly: calendar month (existing behavior)
 * - quarterly: calendar quarter containing the anchor month
 * - yearly: calendar year containing the anchor month
 */
export function deriveKpiPeriodWindow(anchorMonth: string, periodType: KpiPeriodType): KpiPeriodWindow {
    const monthPeriod = deriveKpiMonthPeriod(anchorMonth)
    if (periodType === 'monthly') {
        return { ...monthPeriod, periodType: 'monthly' }
    }

    const [yearStr, monthStr] = anchorMonth.split('-')
    const year = Number(yearStr)
    const month = Number(monthStr)

    if (periodType === 'quarterly') {
        const quarterIndex = Math.floor((month - 1) / 3)
        const startMonth = quarterIndex * 3 + 1
        const endMonth = startMonth + 2
        const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate()
        const periodStart = `${year}-${pad(startMonth)}-01`
        const periodEnd = `${year}-${pad(endMonth)}-${pad(lastDay)}`
        const nextMonth = endMonth === 12 ? 1 : endMonth + 1
        const nextYear = endMonth === 12 ? year + 1 : year
        return {
            kpiMonth: anchorMonth,
            periodType: 'quarterly',
            periodStart,
            periodEnd,
            scanTimeFrom: toDateWithOffset(periodStart),
            scanTimeToExclusive: toDateWithOffset(`${nextYear}-${pad(nextMonth)}-01`),
            label: `Q${quarterIndex + 1} ${year} (${periodStart} – ${periodEnd})`,
        }
    }

    if (periodType === 'yearly') {
        const periodStart = `${year}-01-01`
        const periodEnd = `${year}-12-31`
        return {
            kpiMonth: anchorMonth,
            periodType: 'yearly',
            periodStart,
            periodEnd,
            scanTimeFrom: toDateWithOffset(periodStart),
            scanTimeToExclusive: toDateWithOffset(`${year + 1}-01-01`),
            label: `${year} (${periodStart} – ${periodEnd})`,
        }
    }

    // weekly
    const firstDayOfAnchorMonthUtc = new Date(Date.UTC(year, month - 1, 1))
    const day = firstDayOfAnchorMonthUtc.getUTCDay() // Sun=0..Sat=6
    const daysFromMonday = (day + 6) % 7
    const monday = addDaysUtc(firstDayOfAnchorMonthUtc, -daysFromMonday)
    const sunday = addDaysUtc(monday, 6)
    const nextMonday = addDaysUtc(monday, 7)
    const periodStart = datePartFromUtcDate(monday)
    const periodEnd = datePartFromUtcDate(sunday)
    return {
        kpiMonth: anchorMonth,
        periodType: 'weekly',
        periodStart,
        periodEnd,
        scanTimeFrom: toDateWithOffset(periodStart),
        scanTimeToExclusive: toDateWithOffset(datePartFromUtcDate(nextMonday)),
        label: `Week (${periodStart} – ${periodEnd})`,
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

export interface KpiScanSnapshot {
    /** AM snapshotted on the scan row at scan time. */
    account_manager_user_id: string
    campaign_id: string
}

export interface KpiScanTally {
    /** Successful scans per AM (drives AM achievement). */
    scansByAm: Map<string, number>
    /** Successful scans per campaign (drives the top-campaigns table). */
    scansByCampaign: Map<string, number>
    /** Per campaign, scans split by the team of the snapshotted AM. */
    scansByCampaignTeam: Map<string, Map<string, number>>
}

/**
 * Attribute successful scans to AMs / campaigns / teams using ONLY the AM
 * snapshot carried on each scan row. This is what lets multiple campaigns run
 * under the same RoadTour Event — including several campaigns for the same shop
 * handled by different AMs — resolve cleanly: a scan always counts for the AM
 * (and their team) recorded on that scan, so historical attribution is never
 * rewritten when a shop is later handed to a new campaign/AM.
 */
export function attributeScans(scans: KpiScanSnapshot[], teamIdByAm: Map<string, string>): KpiScanTally {
    const scansByAm = new Map<string, number>()
    const scansByCampaign = new Map<string, number>()
    const scansByCampaignTeam = new Map<string, Map<string, number>>()
    for (const scan of scans) {
        scansByAm.set(scan.account_manager_user_id, (scansByAm.get(scan.account_manager_user_id) || 0) + 1)
        scansByCampaign.set(scan.campaign_id, (scansByCampaign.get(scan.campaign_id) || 0) + 1)
        const teamId = teamIdByAm.get(scan.account_manager_user_id)
        if (teamId) {
            const perTeam = scansByCampaignTeam.get(scan.campaign_id) || new Map<string, number>()
            perTeam.set(teamId, (perTeam.get(teamId) || 0) + 1)
            scansByCampaignTeam.set(scan.campaign_id, perTeam)
        }
    }
    return { scansByAm, scansByCampaign, scansByCampaignTeam }
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

/** Volume bracket for KPI incentive and point-value RM (flat rate per scan in bracket). */
export interface KpiVolumeTier {
    /** Inclusive lower bound (monthly successful scans). */
    min: number
    /** Inclusive upper bound; null = open-ended. */
    max: number | null
    /** RM earned per scan when total monthly volume falls in this bracket. */
    ratePerScan: number
}

/**
 * Standard RoadTour KPI / point-value tiers (flat bracket rate).
 * Below 10,001 scans → no incentive (rate 0).
 */
export const DEFAULT_KPI_VOLUME_TIERS: KpiVolumeTier[] = [
    { min: 0, max: 10_000, ratePerScan: 0 },
    { min: 10_001, max: 20_000, ratePerScan: 0.10 },
    { min: 20_001, max: 30_000, ratePerScan: 0.12 },
    { min: 30_001, max: 40_000, ratePerScan: 0.15 },
    { min: 40_001, max: null, ratePerScan: 0.20 },
]

export function resolveVolumeTier(
    volume: number,
    tiers: KpiVolumeTier[] = DEFAULT_KPI_VOLUME_TIERS,
): KpiVolumeTier {
    const v = Math.max(0, Math.floor(Number(volume) || 0))
    for (const tier of tiers) {
        if (v >= tier.min && (tier.max === null || v <= tier.max)) return tier
    }
    return tiers[0]
}

/** RM per scan for the monthly volume bracket (same rate used for KPI incentive). */
export function resolveVolumeTierRate(
    volume: number,
    tiers: KpiVolumeTier[] = DEFAULT_KPI_VOLUME_TIERS,
): number {
    return resolveVolumeTier(volume, tiers).ratePerScan
}

export function formatVolumeTierRange(tier: KpiVolumeTier): string {
    if (tier.max === null) return `${tier.min.toLocaleString()}+`
    return `${tier.min.toLocaleString()} — ${tier.max.toLocaleString()}`
}

/**
 * Monthly AM KPI incentive: actual scans × bracket rate (flat bracket).
 * Optional per-AM cap still applies after calculation.
 */
export function computeVolumeIncentive(
    volume: number,
    maxIncentivePerAm?: number | null,
    tiers: KpiVolumeTier[] = DEFAULT_KPI_VOLUME_TIERS,
): number {
    const v = Math.max(0, Math.floor(Number(volume) || 0))
    const payout = v * resolveVolumeTierRate(v, tiers)
    if (maxIncentivePerAm && maxIncentivePerAm > 0) return Math.min(payout, maxIncentivePerAm)
    return payout
}

/**
 * Point value (RM per point) aligned with the volume tier.
 * Converts the per-scan bracket rate using points granted per successful reward.
 */
export function resolvePointValueRmForVolume(
    volume: number,
    pointsPerReward = 20,
    tiers: KpiVolumeTier[] = DEFAULT_KPI_VOLUME_TIERS,
): number {
    const pts = Math.max(1, Math.floor(Number(pointsPerReward) || 1))
    return resolveVolumeTierRate(volume, tiers) / pts
}

/** Normalize plan/cycle incentive mode with a safe default. */
export function normalizeAmIncentiveMode(value: unknown): KpiAmIncentiveMode {
    return value === 'achievement_tiers' ? 'achievement_tiers' : 'volume_tiers'
}

export interface AmIncentiveEarningsResult {
    incentiveEarned: number
    volumeTierRate: number | null
    incentiveMode: KpiAmIncentiveMode
    volumeIncentive: number
    achievementBonus: number
}

/** True when an AM meets at least one active achievement gate tier. */
export function hasMetAmAchievementGate(
    rules: KpiIncentiveRuleLike[],
    amPercent: number,
    teamId?: string | null,
): boolean {
    let hasActiveTier = false
    for (const rule of rules) {
        if (rule.status !== 'active') continue
        if (rule.applies_to === 'team_leader') continue
        if (rule.applies_to === 'specific_team' && rule.team_id !== teamId) continue
        hasActiveTier = true
        if (amPercent >= rule.achievement_threshold_percent) return true
    }
    // No configured tiers → default gate at 100% achievement.
    return !hasActiveTier && amPercent >= 100
}

/**
 * Compute AM incentive using the plan's selected model.
 * - volume_tiers: actual scans × bracket RM/scan
 * - achievement_tiers: same volume payout once an achievement gate tier is met
 */
export function computeAmIncentiveEarnings(
    mode: KpiAmIncentiveMode,
    args: {
        actualScans: number
        achievementPercent: number
        amRules: KpiIncentiveRuleLike[]
        teamId?: string | null
        maxIncentivePerAm?: number | null
    },
): AmIncentiveEarningsResult {
    const capTotal = (amount: number) => {
        if (args.maxIncentivePerAm && args.maxIncentivePerAm > 0) return Math.min(amount, args.maxIncentivePerAm)
        return amount
    }
    const volumeRate = resolveVolumeTierRate(args.actualScans)
    const eligibleForVolumePayout = mode === 'volume_tiers'
        || hasMetAmAchievementGate(args.amRules, args.achievementPercent, args.teamId)
    const volumeIncentive = eligibleForVolumePayout
        ? computeVolumeIncentive(args.actualScans, undefined)
        : 0

    return {
        incentiveMode: mode,
        volumeTierRate: eligibleForVolumePayout ? volumeRate : 0,
        volumeIncentive,
        achievementBonus: 0,
        incentiveEarned: capTotal(volumeIncentive),
    }
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
 *
 * `maxIncentivePerAm` is the per-AM monthly cap (from the AM's team). When set
 * and positive, the winning tier payout is clamped to it — an individual AM can
 * never earn more than the cap, no matter how many tiers they clear. The cap
 * applies ONLY to AM incentive; leader bonus (computeLeaderBonus) is separate
 * and additive.
 */
export function computeAmIncentive(
    rules: KpiIncentiveRuleLike[],
    amPercent: number,
    teamId?: string | null,
    maxIncentivePerAm?: number | null,
): number {
    let best: KpiIncentiveRuleLike | null = null
    for (const rule of rules) {
        if (rule.status !== 'active') continue
        if (rule.applies_to === 'team_leader') continue
        if (rule.applies_to === 'specific_team' && rule.team_id !== teamId) continue
        if (amPercent < rule.achievement_threshold_percent) continue
        if (!best || rule.achievement_threshold_percent > best.achievement_threshold_percent) best = rule
    }
    const payout = best ? Number(best.incentive_amount) : 0
    if (maxIncentivePerAm && maxIncentivePerAm > 0) return Math.min(payout, maxIncentivePerAm)
    return payout
}

/** Format a ringgit amount for validation messages (no trailing .00 for whole values). */
export function formatRm(amount: number): string {
    return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

export interface AmTierInput {
    id?: string | null
    achievement_threshold_percent: number
    incentive_amount: number
}

/**
 * Validate a single AM incentive tier against the rest of the AM tier set and
 * the per-AM cap. Returns a human-readable error message, or null when valid.
 * Shared by the settings modal (inline error + disabled Save) and the API so
 * the rules can never be persisted in an illogical state. Rules enforced:
 *  1. threshold >= 100%
 *  2. threshold unique within the AM tier set
 *  3. amount > 0
 *  4. amount <= Max Incentive / AM (when a cap is configured)
 *  5. a higher threshold must pay strictly more than every lower tier
 *  6. a lower threshold must pay strictly less than every higher tier
 */
/** Validate achievement-only AM tiers (threshold % only; payout comes from volume table). */
export function validateAmAchievementThreshold(
    candidate: { id?: string | null; achievement_threshold_percent: number },
    existingTiers: { id?: string | null; achievement_threshold_percent: number }[],
): string | null {
    const threshold = Number(candidate.achievement_threshold_percent)
    if (!Number.isFinite(threshold) || threshold < 100) {
        return 'Achievement threshold must be at least 100%.'
    }
    const others = existingTiers.filter((t) => !(candidate.id && t.id === candidate.id))
    if (others.some((t) => Number(t.achievement_threshold_percent) === threshold)) {
        return `A tier for ${threshold}% already exists.`
    }
    return null
}

export function validateAmIncentiveTier(
    candidate: AmTierInput,
    existingTiers: AmTierInput[],
    maxIncentivePerAm?: number | null,
): string | null {
    const threshold = Number(candidate.achievement_threshold_percent)
    const amount = Number(candidate.incentive_amount)
    if (!Number.isFinite(threshold) || threshold < 100) {
        return 'Achievement threshold must be at least 100%.'
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        return 'Incentive amount must be greater than RM0.'
    }
    if (maxIncentivePerAm && maxIncentivePerAm > 0 && amount > maxIncentivePerAm) {
        return `Incentive cannot exceed the RM${formatRm(maxIncentivePerAm)} max incentive per AM.`
    }
    const others = existingTiers.filter((t) => !(candidate.id && t.id === candidate.id))
    if (others.some((t) => Number(t.achievement_threshold_percent) === threshold)) {
        return `A tier for ${threshold}% already exists.`
    }
    let lower: AmTierInput | null = null // greatest threshold below the candidate
    let higher: AmTierInput | null = null // least threshold above the candidate
    for (const t of others) {
        const tThreshold = Number(t.achievement_threshold_percent)
        if (tThreshold < threshold) {
            if (!lower || tThreshold > Number(lower.achievement_threshold_percent)) lower = t
        } else if (tThreshold > threshold) {
            if (!higher || tThreshold < Number(higher.achievement_threshold_percent)) higher = t
        }
    }
    if (lower && amount <= Number(lower.incentive_amount)) {
        return `Incentive for ${threshold}% must be higher than RM${formatRm(Number(lower.incentive_amount))} because it is above the ${Number(lower.achievement_threshold_percent)}% tier.`
    }
    if (higher && amount >= Number(higher.incentive_amount)) {
        return `Incentive for ${threshold}% must be lower than RM${formatRm(Number(higher.incentive_amount))} because it is below the ${Number(higher.achievement_threshold_percent)}% tier.`
    }
    return null
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
