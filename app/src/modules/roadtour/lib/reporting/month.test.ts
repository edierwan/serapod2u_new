import { describe, expect, it } from 'vitest'

import {
    addCalendarDays,
    canSelectNextMonth,
    currentMonthKey,
    isFutureMonthKey,
    isValidMonthKey,
    monthCoverageLabel,
    normalizeMonthKey,
    reportingCutoffDate,
    reportingDateFromInstant,
    resolveReportingMonth,
    shiftMonthKey,
    todayInReportingZone,
} from './month'

// 21 August 2026, 09:00 Malaysia time.
const NOW = new Date('2026-08-21T01:00:00Z')

describe('month key handling', () => {
    it('accepts only YYYY-MM keys', () => {
        expect(isValidMonthKey('2026-08')).toBe(true)
        expect(isValidMonthKey('2026-13')).toBe(false)
        expect(isValidMonthKey('2026-8')).toBe(false)
        expect(isValidMonthKey(null)).toBe(false)
    })

    it('shifts across year boundaries', () => {
        expect(shiftMonthKey('2026-01', -1)).toBe('2025-12')
        expect(shiftMonthKey('2026-12', 1)).toBe('2027-01')
        expect(shiftMonthKey('2026-08', -3)).toBe('2026-05')
    })

    it('reads the current month in Malaysia local time', () => {
        // 31 Aug 2026 17:00 UTC is already 1 Sep in Malaysia.
        expect(currentMonthKey(new Date('2026-08-31T17:00:00Z'))).toBe('2026-09')
        expect(currentMonthKey(new Date('2026-08-31T15:00:00Z'))).toBe('2026-08')
    })
})

describe('monthly boundary selection', () => {
    it('uses calendar-month boundaries at Malaysia midnight', () => {
        const month = resolveReportingMonth('2026-08', NOW)
        expect(month.startDate).toBe('2026-08-01')
        expect(month.endDate).toBe('2026-08-31')
        expect(month.startUtc).toBe('2026-07-31T16:00:00.000Z')
        expect(month.endUtc).toBe('2026-08-31T16:00:00.000Z')
        expect(month.label).toBe('August 2026')
    })

    it('handles February in a leap year', () => {
        expect(resolveReportingMonth('2024-02', NOW).endDate).toBe('2024-02-29')
    })
})

describe('current month is Month to Date', () => {
    it('flags the month in progress and stops at today', () => {
        const month = resolveReportingMonth('2026-08', NOW)
        expect(month.isCurrentMonth).toBe(true)
        expect(todayInReportingZone(NOW)).toBe('2026-08-21')
        expect(reportingCutoffDate(month, NOW)).toBe('2026-08-21')
        expect(monthCoverageLabel(month, NOW)).toBe('1 – 21 August 2026')
    })

    it('covers a completed month in full', () => {
        const month = resolveReportingMonth('2026-07', NOW)
        expect(month.isCurrentMonth).toBe(false)
        expect(reportingCutoffDate(month, NOW)).toBe('2026-07-31')
        expect(monthCoverageLabel(month, NOW)).toBe('1 – 31 July 2026')
    })
})

describe('future months are blocked', () => {
    it('never resolves a month later than the current one', () => {
        expect(isFutureMonthKey('2026-09', NOW)).toBe(true)
        expect(normalizeMonthKey('2026-09', NOW)).toBe('2026-08')
        expect(normalizeMonthKey('2027-01', NOW)).toBe('2026-08')
    })

    it('disables forward navigation on the current month', () => {
        expect(canSelectNextMonth('2026-08', NOW)).toBe(false)
        expect(canSelectNextMonth('2026-07', NOW)).toBe(true)
    })

    it('falls back to the current month for invalid input', () => {
        expect(normalizeMonthKey('not-a-month', NOW)).toBe('2026-08')
        expect(normalizeMonthKey(undefined, NOW)).toBe('2026-08')
    })
})

describe('date helpers', () => {
    it('reads an instant as a Malaysia calendar date', () => {
        expect(reportingDateFromInstant('2026-08-21T16:30:00Z')).toBe('2026-08-22')
        expect(reportingDateFromInstant('2026-08-21T15:30:00Z')).toBe('2026-08-21')
    })

    it('adds calendar days across month ends', () => {
        expect(addCalendarDays('2026-08-30', 3)).toBe('2026-09-02')
        expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28')
    })
})
