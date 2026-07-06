import { describe, expect, it } from 'vitest'

import {
    amPerformanceStatus,
    autoDistributeTarget,
    achievementPercent,
    computeAmIncentive,
    computeLeaderBonus,
    deriveKpiMonthPeriod,
    formatKpiMonthLabel,
    isValidKpiMonth,
    previousKpiMonth,
    teamPerformanceStatus,
} from './kpi'

describe('deriveKpiMonthPeriod', () => {
    it('derives June 2026 as 1 Jun – 30 Jun', () => {
        const p = deriveKpiMonthPeriod('2026-06')
        expect(p.periodStart).toBe('2026-06-01')
        expect(p.periodEnd).toBe('2026-06-30')
        expect(p.label).toBe('1 Jun 2026 – 30 Jun 2026')
        expect(p.scanTimeFrom).toBe('2026-06-01T00:00:00+08:00')
        expect(p.scanTimeToExclusive).toBe('2026-07-01T00:00:00+08:00')
    })

    it('handles 31-day months and December year rollover', () => {
        const p = deriveKpiMonthPeriod('2026-12')
        expect(p.periodEnd).toBe('2026-12-31')
        expect(p.scanTimeToExclusive).toBe('2027-01-01T00:00:00+08:00')
    })

    it('handles February in leap and non-leap years', () => {
        expect(deriveKpiMonthPeriod('2028-02').periodEnd).toBe('2028-02-29')
        expect(deriveKpiMonthPeriod('2026-02').periodEnd).toBe('2026-02-28')
    })

    it('rejects invalid months', () => {
        expect(isValidKpiMonth('2026-13')).toBe(false)
        expect(isValidKpiMonth('2026-6')).toBe(false)
        expect(() => deriveKpiMonthPeriod('nope')).toThrow()
    })
})

describe('previousKpiMonth', () => {
    it('steps back within a year and across January', () => {
        expect(previousKpiMonth('2026-06')).toBe('2026-05')
        expect(previousKpiMonth('2026-01')).toBe('2025-12')
    })
})

describe('formatKpiMonthLabel', () => {
    it('formats June 2026', () => {
        expect(formatKpiMonthLabel('2026-06')).toBe('June 2026')
    })
})

describe('autoDistributeTarget', () => {
    it('splits evenly: 7000 across 7 members = 1000 each', () => {
        expect(autoDistributeTarget(7000, 7)).toEqual([1000, 1000, 1000, 1000, 1000, 1000, 1000])
    })

    it('assigns remainder to first members and always sums to the target', () => {
        const parts = autoDistributeTarget(1000, 3)
        expect(parts).toEqual([334, 333, 333])
        expect(parts.reduce((a, b) => a + b, 0)).toBe(1000)
    })

    it('returns empty for zero members', () => {
        expect(autoDistributeTarget(1000, 0)).toEqual([])
    })
})

describe('performance status', () => {
    it('classifies teams: Achieved / On Track / At Risk', () => {
        expect(teamPerformanceStatus(102)).toBe('achieved')
        expect(teamPerformanceStatus(90.7)).toBe('on_track')
        expect(teamPerformanceStatus(79.8)).toBe('at_risk')
    })

    it('classifies AMs with a Needs Focus band', () => {
        expect(amPerformanceStatus(102.5)).toBe('achieved')
        expect(amPerformanceStatus(94.7)).toBe('on_track')
        expect(amPerformanceStatus(76.7)).toBe('at_risk')
        expect(amPerformanceStatus(50)).toBe('needs_focus')
    })

    it('achievementPercent guards zero targets', () => {
        expect(achievementPercent(100, 0)).toBe(0)
        expect(achievementPercent(50, 200)).toBe(25)
    })
})

describe('incentives', () => {
    const rules = [
        { applies_to: 'all_ams' as const, achievement_threshold_percent: 100, incentive_amount: 200, status: 'active' },
        { applies_to: 'all_ams' as const, achievement_threshold_percent: 120, incentive_amount: 300, status: 'active' },
        { applies_to: 'team_leader' as const, achievement_threshold_percent: 100, incentive_amount: 500, status: 'active' },
    ]

    it('awards the highest achieved tier to an AM', () => {
        expect(computeAmIncentive(rules, 99)).toBe(0)
        expect(computeAmIncentive(rules, 100)).toBe(200)
        expect(computeAmIncentive(rules, 125)).toBe(300)
    })

    it('ignores inactive rules', () => {
        const inactive = rules.map((r) => ({ ...r, status: 'inactive' }))
        expect(computeAmIncentive(inactive, 150)).toBe(0)
    })

    it('applies team-scoped rules only to that team', () => {
        const scoped = [{ applies_to: 'specific_team' as const, achievement_threshold_percent: 100, incentive_amount: 250, status: 'active', team_id: 'team-a' }]
        expect(computeAmIncentive(scoped, 110, 'team-a')).toBe(250)
        expect(computeAmIncentive(scoped, 110, 'team-b')).toBe(0)
    })

    it('awards leader bonus on team achievement', () => {
        expect(computeLeaderBonus(rules, 100.5)).toBe(500)
        expect(computeLeaderBonus(rules, 99.9)).toBe(0)
    })
})
