import { describe, expect, it } from 'vitest'

import {
    buildTrendSeries,
    isTrendRange,
    malaysiaDateKey,
    resolveTrendWindow,
} from './engagement-trend'

describe('malaysiaDateKey', () => {
    it('puts a scan just after MYT midnight on the Malaysia date, not the UTC date', () => {
        // 2026-09-18 16:30 UTC = 2026-09-19 00:30 MYT
        expect(malaysiaDateKey('2026-09-18T16:30:00Z')).toBe('2026-09-19')
    })

    it('keeps a scan just before MYT midnight on the same Malaysia date', () => {
        // 2026-09-18 15:59:59 UTC = 2026-09-18 23:59:59 MYT
        expect(malaysiaDateKey('2026-09-18T15:59:59Z')).toBe('2026-09-18')
    })
})

describe('resolveTrendWindow', () => {
    // 2026-09-20 17:00 UTC is already 21 Sep in Malaysia
    const now = new Date('2026-09-20T17:00:00Z')

    it('anchors "today" on the Malaysia date', () => {
        expect(resolveTrendWindow('7d', now)).toEqual({ range: '7d', startDate: '2026-09-15', endDate: '2026-09-21' })
    })

    it('resolves each selectable range to an inclusive MYT date window', () => {
        expect(resolveTrendWindow('30d', now)).toMatchObject({ startDate: '2026-08-23', endDate: '2026-09-21' })
        expect(resolveTrendWindow('3m', now)).toMatchObject({ startDate: '2026-06-22', endDate: '2026-09-21' })
        expect(resolveTrendWindow('6m', now)).toMatchObject({ startDate: '2026-03-22', endDate: '2026-09-21' })
        expect(resolveTrendWindow('12m', now)).toMatchObject({ startDate: '2025-09-22', endDate: '2026-09-21' })
        expect(resolveTrendWindow('lastMonth', now)).toMatchObject({ startDate: '2026-08-01', endDate: '2026-08-31' })
    })

    it('handles last month across a year boundary and month-length clamping', () => {
        expect(resolveTrendWindow('lastMonth', new Date('2026-01-10T04:00:00Z')))
            .toMatchObject({ startDate: '2025-12-01', endDate: '2025-12-31' })
        expect(resolveTrendWindow('3m', new Date('2026-05-31T04:00:00Z')))
            .toMatchObject({ startDate: '2026-03-01', endDate: '2026-05-31' })
    })

    it('never exceeds the 400-day cap enforced by the RPC', () => {
        const w = resolveTrendWindow('12m', now)
        const days = (Date.parse(w.endDate) - Date.parse(w.startDate)) / 86_400_000
        expect(days).toBeLessThanOrEqual(400)
    })

    it('validates range params', () => {
        expect(isTrendRange('30d')).toBe(true)
        expect(isTrendRange('365d')).toBe(false)
        expect(isTrendRange(undefined)).toBe(false)
    })
})

describe('buildTrendSeries', () => {
    it('fills every day in the window and keeps only scans / redeemed (no fabricated failed)', () => {
        const series = buildTrendSeries(
            [
                { day: '2026-09-18', scans: '4320', redeemed: 120 },
                { day: '2026-09-20', scans: 5110, redeemed: '138' },
            ],
            '2026-09-17',
            '2026-09-20',
        )
        expect(series).toEqual([
            { date: '2026-09-17', scans: 0, redeemed: 0 },
            { date: '2026-09-18', scans: 4320, redeemed: 120 },
            { date: '2026-09-19', scans: 0, redeemed: 0 },
            { date: '2026-09-20', scans: 5110, redeemed: 138 },
        ])
        expect(series.every(p => !('failed' in p))).toBe(true)
    })

    it('ignores rows outside the requested window', () => {
        const series = buildTrendSeries([{ day: '2026-09-01', scans: 9, redeemed: 0 }], '2026-09-17', '2026-09-18')
        expect(series.map(p => p.scans)).toEqual([0, 0])
    })
})
