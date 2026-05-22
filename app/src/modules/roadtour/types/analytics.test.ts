import { describe, expect, it } from 'vitest'
import {
    classifyImpactStatus,
    computeScanLiftPercent,
    classifyFollowUpPriority,
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
    it('returns maintained when before equals after (both positive)', () => {
        expect(classifyImpactStatus(4, 4)).toBe('maintained')
    })
    it('returns dropped when after is less than before', () => {
        expect(classifyImpactStatus(5, 2)).toBe('dropped')
    })
})

describe('computeScanLiftPercent', () => {
    it('returns null when before == 0', () => {
        expect(computeScanLiftPercent(0, 0)).toBeNull()
        expect(computeScanLiftPercent(0, 5)).toBeNull()
    })
    it('computes percent change when before > 0', () => {
        expect(computeScanLiftPercent(10, 15)).toBe(50)
        expect(computeScanLiftPercent(10, 5)).toBe(-50)
    })
})

describe('classifyFollowUpPriority', () => {
    const base = { status: 'improved' as const, before_scans: 0, after_scans: 0, days_since_visit: 0 }
    it('high when no scan in 7+ days', () => {
        expect(classifyFollowUpPriority({ ...base, status: 'no_response', after_scans: 0, days_since_visit: 8 })).toBe('high')
    })
    it('high when drop > 50%', () => {
        expect(classifyFollowUpPriority({ status: 'dropped', before_scans: 10, after_scans: 2, days_since_visit: 1 })).toBe('high')
    })
    it('medium when no response 3-6 days', () => {
        expect(classifyFollowUpPriority({ ...base, status: 'no_response', days_since_visit: 4 })).toBe('medium')
    })
    it('medium for newly activated', () => {
        expect(classifyFollowUpPriority({ ...base, status: 'newly_activated', after_scans: 5 })).toBe('medium')
    })
    it('healthy when improved with >=50% lift', () => {
        expect(classifyFollowUpPriority({ status: 'improved', before_scans: 10, after_scans: 20, days_since_visit: 2 })).toBe('healthy')
    })
    it('low otherwise', () => {
        expect(classifyFollowUpPriority({ status: 'improved', before_scans: 10, after_scans: 11, days_since_visit: 2 })).toBe('low')
    })
})

describe('recommendedAction', () => {
    it('immediate visit for high no_response', () => {
        expect(recommendedAction('high', 'no_response', 8)).toBe('Immediate Visit')
    })
    it('nurture for medium newly_activated', () => {
        expect(recommendedAction('medium', 'newly_activated', 2)).toBe('Nurture Engagement')
    })
    it('praise & upsell for low improved', () => {
        expect(recommendedAction('low', 'improved', 1)).toBe('Praise & Upsell')
    })
})

describe('recommendedFollowUpDate', () => {
    it('returns ISO yyyy-mm-dd', () => {
        const d = recommendedFollowUpDate('2026-05-20', 'high')
        expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
})
