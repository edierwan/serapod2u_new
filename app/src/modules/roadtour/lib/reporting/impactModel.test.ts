import { describe, expect, it } from 'vitest'

import {
    classifyShopOutcome,
    computeScanLiftPercent,
    daysSinceVisit,
    hasResponded,
    isObservationMature,
    medianOf,
    normalizeImpactWindowDays,
    observationMaturesAt,
    OFFICIAL_IMPACT_WINDOW_DAYS,
} from './impactModel'

const VISIT_AT = '2026-08-01T02:00:00.000Z'

function daysAfterVisit(days: number, extraMs = 0): Date {
    return new Date(new Date(VISIT_AT).getTime() + days * 86_400_000 + extraMs)
}

describe('official impact window', () => {
    it('defaults to seven days and only allows the approved drill-downs', () => {
        expect(OFFICIAL_IMPACT_WINDOW_DAYS).toBe(7)
        expect(normalizeImpactWindowDays(3)).toBe(3)
        expect(normalizeImpactWindowDays(30)).toBe(30)
        expect(normalizeImpactWindowDays(60)).toBe(7)
        expect(normalizeImpactWindowDays(90)).toBe(7)
        expect(normalizeImpactWindowDays('custom')).toBe(7)
        expect(normalizeImpactWindowDays(null)).toBe(7)
    })
})

describe('7D maturity boundary', () => {
    it('is pending until seven complete days have elapsed', () => {
        expect(isObservationMature(VISIT_AT, 7, daysAfterVisit(0))).toBe(false)
        expect(isObservationMature(VISIT_AT, 7, daysAfterVisit(3))).toBe(false)
        expect(isObservationMature(VISIT_AT, 7, daysAfterVisit(6))).toBe(false)
        expect(isObservationMature(VISIT_AT, 7, daysAfterVisit(7, -1))).toBe(false)
    })

    it('is mature at exactly seven days and beyond', () => {
        expect(isObservationMature(VISIT_AT, 7, daysAfterVisit(7))).toBe(true)
        expect(isObservationMature(VISIT_AT, 7, daysAfterVisit(8))).toBe(true)
        expect(isObservationMature(VISIT_AT, 7, daysAfterVisit(40))).toBe(true)
    })

    it('exposes when the window completes', () => {
        expect(observationMaturesAt(VISIT_AT, 7)).toBe(daysAfterVisit(7).getTime())
    })

    it('counts whole elapsed days and never goes negative', () => {
        expect(daysSinceVisit(VISIT_AT, daysAfterVisit(0))).toBe(0)
        expect(daysSinceVisit(VISIT_AT, daysAfterVisit(6, -1))).toBe(5)
        expect(daysSinceVisit(VISIT_AT, daysAfterVisit(-3))).toBe(0)
    })
})

describe('pending observation', () => {
    it('is pending regardless of scan counts while the window is open', () => {
        expect(classifyShopOutcome({ beforeScans: 0, afterScans: 0, matured: false })).toBe('pending_observation')
        expect(classifyShopOutcome({ beforeScans: 5, afterScans: 0, matured: false })).toBe('pending_observation')
        expect(classifyShopOutcome({ beforeScans: 0, afterScans: 9, matured: false })).toBe('pending_observation')
    })

    it('never counts a pending visit as a responder', () => {
        expect(hasResponded({ matured: false, afterScans: 4 })).toBe(false)
        expect(hasResponded({ matured: true, afterScans: 4 })).toBe(true)
        expect(hasResponded({ matured: true, afterScans: 0 })).toBe(false)
    })
})

describe('outcome classification', () => {
    it('reports zero-before, positive-after as Newly Activated', () => {
        expect(classifyShopOutcome({ beforeScans: 0, afterScans: 1, matured: true })).toBe('newly_activated')
        expect(classifyShopOutcome({ beforeScans: 0, afterScans: 42, matured: true })).toBe('newly_activated')
    })

    it('classifies improved, maintained and dropped', () => {
        expect(classifyShopOutcome({ beforeScans: 2, afterScans: 5, matured: true })).toBe('improved')
        expect(classifyShopOutcome({ beforeScans: 4, afterScans: 4, matured: true })).toBe('maintained')
        expect(classifyShopOutcome({ beforeScans: 5, afterScans: 2, matured: true })).toBe('dropped')
    })

    it('classifies a matured window with no after scans as No Response', () => {
        expect(classifyShopOutcome({ beforeScans: 0, afterScans: 0, matured: true })).toBe('no_response')
        expect(classifyShopOutcome({ beforeScans: 9, afterScans: 0, matured: true })).toBe('no_response')
    })
})

describe('lift maths', () => {
    it('never produces an infinite lift from a zero baseline', () => {
        expect(computeScanLiftPercent(0, 8)).toBeNull()
        expect(computeScanLiftPercent(0, 0)).toBeNull()
        expect(Number.isFinite(computeScanLiftPercent(10, 15) as number)).toBe(true)
    })

    it('computes percentage change against a real baseline', () => {
        expect(computeScanLiftPercent(10, 15)).toBe(50)
        expect(computeScanLiftPercent(10, 5)).toBe(-50)
    })

    it('takes a median that a tiny baseline cannot dominate', () => {
        expect(medianOf([])).toBeNull()
        expect(medianOf([10, 20, 30])).toBe(20)
        expect(medianOf([10, 20, 30, 40])).toBe(25)
        expect(medianOf([5, 10, 15, 20, 900])).toBe(15)
    })
})
