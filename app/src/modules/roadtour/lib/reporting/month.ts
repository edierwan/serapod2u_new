// Shared month model for RoadTour Reporting.
//
// Every redesigned report ("Monthly Overview", "AM Performance", "Shop Follow-Up",
// "Visit Log") selects one calendar month with a single `← August 2026 →` control.
// Boundaries follow the application's Malaysia-local reporting convention
// (`lib/reporting/reporting-period`), so a month starts at 00:00 +08:00 and ends
// at 00:00 +08:00 on the first of the next month.

import {
    REPORTING_TIME_ZONE,
    currentReportingPeriodKey,
    reportingPeriodFromKey,
} from '@/lib/reporting/reporting-period'

export { REPORTING_TIME_ZONE }

export const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
export const MONTH_TO_DATE_LABEL = 'Month to Date'

export interface ReportingMonth {
    /** `YYYY-MM` */
    key: string
    /** `August 2026` */
    label: string
    /** Inclusive start of the month, ISO UTC instant of 00:00 +08:00. */
    startUtc: string
    /** Exclusive end of the month, ISO UTC instant of 00:00 +08:00 next month. */
    endUtc: string
    /** Inclusive first calendar date, `YYYY-MM-DD`. */
    startDate: string
    /** Inclusive last calendar date, `YYYY-MM-DD`. */
    endDate: string
    /** True while the selected month is the month in progress (Month to Date). */
    isCurrentMonth: boolean
}

export function isValidMonthKey(value: unknown): value is string {
    return typeof value === 'string' && MONTH_KEY_PATTERN.test(value)
}

/** `YYYY-MM` of "now" in Malaysia local time. */
export function currentMonthKey(now: Date = new Date()): string {
    return currentReportingPeriodKey(now)
}

/** `YYYY-MM-DD` of "now" in Malaysia local time. */
export function todayInReportingZone(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: REPORTING_TIME_ZONE,
    }).format(now)
}

/** Move a `YYYY-MM` key by whole months. */
export function shiftMonthKey(key: string, delta: number): string {
    const [year, month] = key.split('-').map(Number)
    const zeroBased = year * 12 + (month - 1) + delta
    const nextYear = Math.floor(zeroBased / 12)
    const nextMonth = zeroBased - nextYear * 12 + 1
    return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`
}

/**
 * How many months of already-visited shops a report may pull in ahead of the
 * selected month. Shop Follow-Up uses this so an unresolved shop stays in the
 * queue after the month of its visit ends; month-scoped reports pass 0.
 */
export const MAX_CARRY_FORWARD_MONTHS = 12

export function normalizeCarryForwardMonths(value: unknown): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) return 0
    return Math.min(Math.floor(parsed), MAX_CARRY_FORWARD_MONTHS)
}

/** Management reporting never looks into the future. */
export function isFutureMonthKey(key: string, now: Date = new Date()): boolean {
    return key > currentMonthKey(now)
}

/** True when `→` should be enabled — i.e. the next month is not in the future. */
export function canSelectNextMonth(key: string, now: Date = new Date()): boolean {
    return !isFutureMonthKey(shiftMonthKey(key, 1), now)
}

/**
 * Coerce any user/URL supplied value into a selectable month key.
 * Invalid values and future months both fall back to the current month.
 */
export function normalizeMonthKey(value: unknown, now: Date = new Date()): string {
    if (!isValidMonthKey(value)) return currentMonthKey(now)
    if (isFutureMonthKey(value, now)) return currentMonthKey(now)
    return value
}

export function resolveReportingMonth(value: unknown, now: Date = new Date()): ReportingMonth {
    const key = normalizeMonthKey(value, now)
    const period = reportingPeriodFromKey(key)!
    return {
        key,
        label: period.label,
        startUtc: period.startUtc,
        endUtc: period.endUtc,
        startDate: period.startDate,
        endDate: period.endDate,
        isCurrentMonth: key === currentMonthKey(now),
    }
}

/**
 * The last calendar date covered by the report. For the month in progress this
 * is today (Month to Date), otherwise the last day of the month.
 */
export function reportingCutoffDate(month: ReportingMonth, now: Date = new Date()): string {
    return month.isCurrentMonth ? todayInReportingZone(now) : month.endDate
}

/** `1 – 21 August 2026` (Month to Date) or `1 – 31 July 2026`. */
export function monthCoverageLabel(month: ReportingMonth, now: Date = new Date()): string {
    const cutoff = reportingCutoffDate(month, now)
    const startDay = Number(month.startDate.slice(8, 10))
    const endDay = Number(cutoff.slice(8, 10))
    return `${startDay} – ${endDay} ${month.label}`
}

/** `YYYY-MM-DD` (Malaysia local) for an ISO instant. */
export function reportingDateFromInstant(iso: string | Date): string {
    const value = typeof iso === 'string' ? new Date(iso) : iso
    if (Number.isNaN(value.getTime())) return ''
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: REPORTING_TIME_ZONE,
    }).format(value)
}

/** Add whole days to a `YYYY-MM-DD` calendar date. */
export function addCalendarDays(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00Z`)
    value.setUTCDate(value.getUTCDate() + days)
    return value.toISOString().slice(0, 10)
}
