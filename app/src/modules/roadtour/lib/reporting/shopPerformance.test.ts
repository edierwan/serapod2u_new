import { describe, expect, it } from 'vitest'

import {
    buildShopPerformanceRows,
    buildShopPerformanceSummary,
    classifyShopPerformance,
    computeMonthlyChangePercent,
    needsAttention,
    type ShopMonthlyScanTotal,
} from './shopPerformance'

const SHOPS = new Map([
    ['shop-1', {
        shopName: 'Kloud Room (Bayan Lepas)', shopNamePrimary: 'Kloud Room',
        shopBranchLabel: 'Bayan Lepas', shopCode: 'SH001', region: 'Penang', shopStateId: 'state-1',
    }],
    ['shop-2', {
        shopName: 'Mr Vapor', shopNamePrimary: 'Mr Vapor',
        shopBranchLabel: null, shopCode: 'SH306', region: 'Selangor', shopStateId: 'state-2',
    }],
])

const TRAIL = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']

function build(totals: ShopMonthlyScanTotal[]) {
    return buildShopPerformanceRows({
        totals, monthKey: '2026-09', previousMonthKey: '2026-08', trailMonthKeys: TRAIL, shops: SHOPS,
    })
}

describe('monthly shop state', () => {
    it('classifies the five business states', () => {
        expect(classifyShopPerformance(120, 100)).toBe('improved')
        expect(classifyShopPerformance(100, 100)).toBe('maintained')
        expect(classifyShopPerformance(80, 100)).toBe('declined')
        expect(classifyShopPerformance(40, 0)).toBe('newly_active')
        expect(classifyShopPerformance(0, 100)).toBe('no_activity')
    })

    it('treats a shop with no scans in either month as no activity', () => {
        expect(classifyShopPerformance(0, 0)).toBe('no_activity')
    })

    it('does not normalise by days in the month', () => {
        // February (28 days) against March (31 days), same total. Raw totals are
        // equal, so the shop is Maintained — a per-day rate would call it Declined.
        expect(classifyShopPerformance(280, 280)).toBe('maintained')
    })

    it('reports change against the previous month, and nothing when there is no baseline', () => {
        expect(computeMonthlyChangePercent(150, 100)).toBeCloseTo(50)
        expect(computeMonthlyChangePercent(50, 100)).toBeCloseTo(-50)
        expect(computeMonthlyChangePercent(50, 0)).toBeNull()
    })
})

describe('shop performance rows', () => {
    it('compares the selected month against the previous one', () => {
        const rows = build([
            { shopId: 'shop-1', monthKey: '2026-08', scans: 100 },
            { shopId: 'shop-1', monthKey: '2026-09', scans: 130 },
        ])
        expect(rows).toHaveLength(1)
        expect(rows[0].previousScans).toBe(100)
        expect(rows[0].currentScans).toBe(130)
        expect(rows[0].delta).toBe(30)
        expect(rows[0].state).toBe('improved')
    })

    it('keeps a shop that went quiet — the case management most needs', () => {
        const rows = build([{ shopId: 'shop-2', monthKey: '2026-08', scans: 90 }])
        expect(rows).toHaveLength(1)
        expect(rows[0].currentScans).toBe(0)
        expect(rows[0].state).toBe('no_activity')
        expect(needsAttention(rows[0])).toBe(true)
    })

    it('drops a shop with no activity in either month rather than padding the report', () => {
        expect(build([{ shopId: 'shop-1', monthKey: '2026-04', scans: 12 }])).toEqual([])
    })

    it('ignores shops outside the RoadTour cohort', () => {
        expect(build([{ shopId: 'shop-unknown', monthKey: '2026-09', scans: 50 }])).toEqual([])
    })

    it('builds a six-month trail, zero-filling months with no scans', () => {
        const rows = build([
            { shopId: 'shop-1', monthKey: '2026-07', scans: 10 },
            { shopId: 'shop-1', monthKey: '2026-09', scans: 30 },
        ])
        expect(rows[0].trail.map((point) => point.scans)).toEqual([0, 0, 0, 10, 0, 30])
        expect(rows[0].trail.map((point) => point.monthKey)).toEqual(TRAIL)
    })

    it('summarises the cohort by state', () => {
        const rows = build([
            { shopId: 'shop-1', monthKey: '2026-08', scans: 100 },
            { shopId: 'shop-1', monthKey: '2026-09', scans: 130 },
            { shopId: 'shop-2', monthKey: '2026-08', scans: 90 },
        ])
        const summary = buildShopPerformanceSummary(rows)
        expect(summary.shopsReported).toBe(2)
        expect(summary.totalCurrentScans).toBe(130)
        expect(summary.totalPreviousScans).toBe(190)
        expect(summary.totalDelta).toBe(-60)
        expect(summary.stateCounts.improved).toBe(1)
        expect(summary.stateCounts.no_activity).toBe(1)
    })
})

describe('separation from AM Performance', () => {
    it('reports a shop in a month with no RoadTour visit at all', () => {
        // July 2026 in production: zero official visits, but real shop activity.
        // AM Performance is empty; Shop Performance must not be.
        const rows = buildShopPerformanceRows({
            totals: [
                { shopId: 'shop-1', monthKey: '2026-06', scans: 400 },
                { shopId: 'shop-1', monthKey: '2026-07', scans: 460 },
            ],
            monthKey: '2026-07', previousMonthKey: '2026-06',
            trailMonthKeys: ['2026-06', '2026-07'], shops: SHOPS,
        })
        expect(rows).toHaveLength(1)
        expect(rows[0].state).toBe('improved')
        expect(rows[0].currentScans).toBe(460)
    })
})
