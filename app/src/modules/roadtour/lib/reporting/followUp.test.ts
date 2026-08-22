import { describe, expect, it } from 'vitest'

import {
    classifyFollowUpPriority,
    followUpDueDate,
    followUpState,
    isActionableFollowUp,
    recommendedAction,
    SCAN_DROP_HIGH_PRIORITY_THRESHOLD,
} from './followUp'

const NOW = new Date('2026-08-21T01:00:00Z') // 21 Aug 2026, Malaysia

function input(overrides: Partial<Parameters<typeof classifyFollowUpPriority>[0]> = {}) {
    return {
        outcome: 'improved' as const,
        matured: true,
        beforeScans: 4,
        afterScans: 8,
        hasAccountManager: true,
        ...overrides,
    }
}

describe('follow-up priority', () => {
    it('never raises a pending-observation shop to high priority', () => {
        expect(classifyFollowUpPriority(input({ matured: false, afterScans: 0, outcome: 'pending_observation' })))
            .toBe('observing')
    })

    it('flags a matured shop with no additional scan as high priority', () => {
        expect(classifyFollowUpPriority(input({ outcome: 'no_response', beforeScans: 3, afterScans: 0 })))
            .toBe('high')
    })

    it('flags a drop beyond the agreed threshold as high priority', () => {
        expect(SCAN_DROP_HIGH_PRIORITY_THRESHOLD).toBe(0.5)
        expect(classifyFollowUpPriority(input({ outcome: 'dropped', beforeScans: 10, afterScans: 4 }))).toBe('high')
        // Exactly at the threshold is a drop, not an emergency.
        expect(classifyFollowUpPriority(input({ outcome: 'dropped', beforeScans: 10, afterScans: 5 }))).toBe('medium')
    })

    it('treats newly activated and thin maintenance as medium', () => {
        expect(classifyFollowUpPriority(input({ outcome: 'newly_activated', beforeScans: 0, afterScans: 2 }))).toBe('medium')
        expect(classifyFollowUpPriority(input({ outcome: 'maintained', beforeScans: 1, afterScans: 1 }))).toBe('medium')
    })

    it('treats a healthy improvement as healthy', () => {
        expect(classifyFollowUpPriority(input({ outcome: 'improved', beforeScans: 4, afterScans: 9 }))).toBe('healthy')
        expect(classifyFollowUpPriority(input({ outcome: 'maintained', beforeScans: 6, afterScans: 6 }))).toBe('low')
    })

    it('marks only high and medium as actionable', () => {
        expect(isActionableFollowUp('high')).toBe(true)
        expect(isActionableFollowUp('medium')).toBe(true)
        expect(isActionableFollowUp('observing')).toBe(false)
        expect(isActionableFollowUp('healthy')).toBe(false)
        expect(isActionableFollowUp('low')).toBe(false)
    })
})

describe('recommended action', () => {
    it('asks for an owner before anything else', () => {
        expect(recommendedAction(input({ hasAccountManager: false, outcome: 'no_response', afterScans: 0 }), 'high'))
            .toBe('Assign AM')
    })

    it('maps each priority to one concise action', () => {
        expect(recommendedAction(input({ outcome: 'no_response', afterScans: 0 }), 'high')).toBe('Revisit')
        expect(recommendedAction(input({ outcome: 'dropped', beforeScans: 10, afterScans: 3 }), 'high')).toBe('Call Shop')
        expect(recommendedAction(input({ outcome: 'newly_activated', beforeScans: 0, afterScans: 2 }), 'medium')).toBe('Nurture Activation')
        expect(recommendedAction(input({ outcome: 'dropped', beforeScans: 10, afterScans: 6 }), 'medium')).toBe('Call Shop')
        expect(recommendedAction(input({ outcome: 'improved' }), 'healthy')).toBe('Praise & Upsell')
        expect(recommendedAction(input({ outcome: 'pending_observation', matured: false }), 'observing')).toBe('Monitor')
        expect(recommendedAction(input({ outcome: 'maintained' }), 'low')).toBe('Monitor')
    })
})

describe('follow-up due date', () => {
    const maturesAt = '2026-08-10T04:00:00.000Z' // 10 Aug 2026 Malaysia

    it('derives the due date from the observation deadline, not from today', () => {
        expect(followUpDueDate(maturesAt, 'high')).toBe('2026-08-10')
        expect(followUpDueDate(maturesAt, 'medium')).toBe('2026-08-13')
        expect(followUpDueDate(maturesAt, 'low')).toBe('2026-08-24')
        expect(followUpDueDate(maturesAt, 'healthy')).toBe('2026-08-31')
    })

    it('reports overdue, due today and upcoming against Malaysia local today', () => {
        expect(followUpState('2026-08-10', NOW)).toBe('overdue')
        expect(followUpState('2026-08-21', NOW)).toBe('due_today')
        expect(followUpState('2026-08-24', NOW)).toBe('upcoming')
    })
})
