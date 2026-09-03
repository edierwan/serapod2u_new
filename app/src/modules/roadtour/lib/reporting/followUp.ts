// Follow-Up priority, recommended action and due date.
//
// Shop Follow-Up is an action queue, so every row must resolve to one concise
// action and one date a manager can be held to. Priority is derived from the
// shop's CURRENT visit (the latest of the month), never from a stale earlier one.

import { addCalendarDays, reportingDateFromInstant, todayInReportingZone } from './month'
import type { ShopOutcome } from './impactModel'

/** A drop larger than this against a real baseline is treated as high priority. */
export const SCAN_DROP_HIGH_PRIORITY_THRESHOLD = 0.5

export type FollowUpPriority = 'high' | 'medium' | 'low' | 'healthy' | 'observing'

export const FOLLOW_UP_PRIORITY_LABEL: Record<FollowUpPriority, string> = {
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    healthy: 'Healthy',
    observing: 'Observing',
}

export const RECOMMENDED_ACTIONS = [
    'Assign AM',
    'Revisit',
    'Call Shop',
    'Nurture Activation',
    'Monitor',
    'Praise & Upsell',
] as const

export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number]

export interface FollowUpInput {
    outcome: ShopOutcome
    matured: boolean
    beforeScans: number
    afterScans: number
    hasAccountManager: boolean
}

/**
 * A visit still inside its observation window is `observing` — never high
 * priority just because seven days have not elapsed yet.
 */
export function classifyFollowUpPriority(input: FollowUpInput): FollowUpPriority {
    if (!input.matured) return 'observing'

    if (input.afterScans <= 0) return 'high'

    if (input.beforeScans > 0) {
        const dropRatio = (input.beforeScans - input.afterScans) / input.beforeScans
        if (dropRatio > SCAN_DROP_HIGH_PRIORITY_THRESHOLD) return 'high'
    }

    if (input.outcome === 'dropped') return 'medium'
    if (input.outcome === 'newly_activated') return 'medium'
    if (input.outcome === 'maintained' && input.afterScans <= 1) return 'medium'
    if (input.outcome === 'improved') return 'healthy'
    return 'low'
}

export function recommendedAction(input: FollowUpInput, priority: FollowUpPriority): RecommendedAction {
    if (!input.hasAccountManager) return 'Assign AM'
    if (priority === 'observing') return 'Monitor'
    if (priority === 'high') return input.afterScans <= 0 ? 'Revisit' : 'Call Shop'
    if (input.outcome === 'newly_activated') return 'Nurture Activation'
    if (priority === 'medium') return 'Call Shop'
    if (priority === 'healthy') return 'Praise & Upsell'
    return 'Monitor'
}

/**
 * Deterministic due date derived from the observation deadline, not from "today"
 * — so an old high-priority shop actually reads as overdue.
 */
export function followUpDueDate(maturesAtIso: string, priority: FollowUpPriority): string {
    const maturedOn = reportingDateFromInstant(maturesAtIso)
    if (!maturedOn) return ''
    if (priority === 'high') return maturedOn
    if (priority === 'medium') return addCalendarDays(maturedOn, 3)
    if (priority === 'observing') return maturedOn
    if (priority === 'healthy') return addCalendarDays(maturedOn, 21)
    return addCalendarDays(maturedOn, 14)
}

export type FollowUpState = 'overdue' | 'due_today' | 'upcoming'

export function followUpState(dueDate: string, now: Date = new Date()): FollowUpState {
    const today = todayInReportingZone(now)
    if (dueDate < today) return 'overdue'
    if (dueDate === today) return 'due_today'
    return 'upcoming'
}

/** Only matured shops can be actioned; observing shops are informational. */
export function isActionableFollowUp(priority: FollowUpPriority): boolean {
    return priority === 'high' || priority === 'medium'
}
