import { describe, expect, it } from 'vitest'
import {
    classifyFollowUpPriority,
    classifyImpactStatus,
    computeScanLiftPercent,
    getLatestVisitRowsByShop,
    recommendedAction,
    recommendedFollowUpDate,
} from './analytics'

describe('classifyImpactStatus', () => {
    it('returns no_response when both windows are zero', () => {
        expect(classifyImpactStatus(0, 0)).toBe('no_response')
    })

    it('returns newly_activated when only after has activity', () => {
        expect(classifyImpactStatus(0, 5)).toBe('newly_activated')
    })

    it('returns no_response when after is zero and before had activity', () => {
        expect(classifyImpactStatus(3, 0)).toBe('no_response')
    })

    it('returns improved when after exceeds before', () => {
        expect(classifyImpactStatus(2, 5)).toBe('improved')
    })

    it('returns maintained when before equals after', () => {
        expect(classifyImpactStatus(4, 4)).toBe('maintained')
    })

    it('returns dropped when after is less than before', () => {
        expect(classifyImpactStatus(5, 2)).toBe('dropped')
    })
})

describe('computeScanLiftPercent', () => {
    it('returns null when before is zero', () => {
        expect(computeScanLiftPercent(0, 0)).toBeNull()
        expect(computeScanLiftPercent(0, 5)).toBeNull()
    })

    it('computes percent change when before is positive', () => {
        expect(computeScanLiftPercent(10, 15)).toBe(50)
        expect(computeScanLiftPercent(10, 5)).toBe(-50)
    })
})

describe('classifyFollowUpPriority', () => {
    const base = {
        status: 'improved' as const,
        before_scans: 0,
        after_scans: 0,
        days_since_visit: 0,
    }

    it('returns high when there is no scan in 7 or more days', () => {
        expect(
            classifyFollowUpPriority({
                ...base,
                status: 'no_response',
                after_scans: 0,
                days_since_visit: 8,
            }),
        ).toBe('high')
    })

    it('returns high when the drop is greater than 50 percent', () => {
        expect(
            classifyFollowUpPriority({
                status: 'dropped',
                before_scans: 10,
                after_scans: 2,
                days_since_visit: 1,
            }),
        ).toBe('high')
    })

    it('returns medium when there is no response between 3 and 6 days', () => {
        expect(
            classifyFollowUpPriority({
                ...base,
                status: 'no_response',
                days_since_visit: 4,
            }),
        ).toBe('medium')
    })

    it('returns medium for newly activated shops', () => {
        expect(
            classifyFollowUpPriority({
                ...base,
                status: 'newly_activated',
                after_scans: 5,
            }),
        ).toBe('medium')
    })

    it('returns healthy for strong positive lift', () => {
        expect(
            classifyFollowUpPriority({
                status: 'improved',
                before_scans: 10,
                after_scans: 20,
                days_since_visit: 2,
            }),
        ).toBe('healthy')
    })

    it('returns low otherwise', () => {
        expect(
            classifyFollowUpPriority({
                status: 'improved',
                before_scans: 10,
                after_scans: 11,
                days_since_visit: 2,
            }),
        ).toBe('low')
    })

    it('uses the selected window when classifying no-response shops', () => {
        expect(
            classifyFollowUpPriority({
                ...base,
                status: 'no_response',
                days_since_visit: 29,
            }, 30),
        ).toBe('medium')

        expect(
            classifyFollowUpPriority({
                ...base,
                status: 'no_response',
                days_since_visit: 30,
            }, 30),
        ).toBe('high')
    })
})

describe('getLatestVisitRowsByShop', () => {
    it('keeps only the latest visit per shop', () => {
        const rows = getLatestVisitRowsByShop([
            {
                visit_id: 'visit-1',
                visit_date: '2026-05-01',
                campaign_id: 'campaign-1',
                campaign_name: 'Campaign 1',
                account_manager_user_id: 'am-1',
                account_manager_name: 'Manager 1',
                shop_id: 'shop-1',
                shop_name: 'Shop 1',
                shop_code: 'S1',
                shop_region: 'Selangor',
                before_scans: 1,
                after_scans: 2,
                scan_lift: 1,
                scan_lift_percent: 100,
                status: 'improved',
                days_since_visit: 10,
                first_scan_after_at: '2026-05-02T00:00:00.000Z',
                last_scan_after_at: '2026-05-03T00:00:00.000Z',
                daily_before: [],
                daily_after: [],
                notes: null,
            },
            {
                visit_id: 'visit-2',
                visit_date: '2026-05-09',
                campaign_id: 'campaign-1',
                campaign_name: 'Campaign 1',
                account_manager_user_id: 'am-1',
                account_manager_name: 'Manager 1',
                shop_id: 'shop-1',
                shop_name: 'Shop 1',
                shop_code: 'S1',
                shop_region: 'Selangor',
                before_scans: 2,
                after_scans: 4,
                scan_lift: 2,
                scan_lift_percent: 100,
                status: 'improved',
                days_since_visit: 2,
                first_scan_after_at: '2026-05-10T00:00:00.000Z',
                last_scan_after_at: '2026-05-11T00:00:00.000Z',
                daily_before: [],
                daily_after: [],
                notes: null,
            },
            {
                visit_id: 'visit-3',
                visit_date: '2026-05-07',
                campaign_id: 'campaign-1',
                campaign_name: 'Campaign 1',
                account_manager_user_id: 'am-2',
                account_manager_name: 'Manager 2',
                shop_id: 'shop-2',
                shop_name: 'Shop 2',
                shop_code: 'S2',
                shop_region: 'Kuala Lumpur',
                before_scans: 0,
                after_scans: 0,
                scan_lift: 0,
                scan_lift_percent: null,
                status: 'no_response',
                days_since_visit: 4,
                first_scan_after_at: null,
                last_scan_after_at: null,
                daily_before: [],
                daily_after: [],
                notes: null,
            },
        ])

        expect(rows).toHaveLength(2)
        expect(rows.find((row) => row.shop_id === 'shop-1')?.visit_id).toBe('visit-2')
        expect(rows.find((row) => row.shop_id === 'shop-2')?.visit_id).toBe('visit-3')
    })
})

describe('recommendedAction', () => {
    it('returns immediate visit for high no_response', () => {
        expect(recommendedAction('high', 'no_response', 8)).toBe('Immediate Visit')
    })

    it('returns nurture engagement for medium newly_activated', () => {
        expect(recommendedAction('medium', 'newly_activated', 2)).toBe('Nurture Engagement')
    })

    it('returns praise and upsell for low improved', () => {
        expect(recommendedAction('low', 'improved', 1)).toBe('Praise & Upsell')
    })
})

describe('recommendedFollowUpDate', () => {
    it('returns an ISO yyyy-mm-dd date string', () => {
        expect(recommendedFollowUpDate('2026-05-20', 'high')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
})