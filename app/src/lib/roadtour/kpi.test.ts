import { describe, expect, it } from 'vitest'

import {
    addKpiMonths,
    amPerformanceStatus,
    attributeScans,
    autoDistributeTarget,
    achievementPercent,
    compareKpiMonth,
    computeAmIncentive,
    computeAmIncentiveEarnings,
    computeLeaderBonus,
    computeVolumeIncentive,
    currentKpiMonth,
    deriveEffectiveFromOptions,
    deriveEffectiveToOptions,
    deriveKpiMonthPeriod,
    effectiveIncentiveRules,
    enumerateMonthRange,
    enumeratePlanMonths,
    formatKpiMonthLabel,
    isMonthInEffectiveRange,
    isValidKpiMonth,
    monthKeyFromDate,
    previousKpiMonth,
    resolveLeaderId,
    resolvePointValueRmForVolume,
    resolveVolumeTierRate,
    teamPerformanceStatus,
    validateAmIncentiveTier,
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

describe('volume tier incentives (KPI + point value)', () => {
    it('resolveVolumeTierRate picks the flat bracket rate', () => {
        expect(resolveVolumeTierRate(0)).toBe(0)
        expect(resolveVolumeTierRate(10_000)).toBe(0)
        expect(resolveVolumeTierRate(10_001)).toBe(0.10)
        expect(resolveVolumeTierRate(15_000)).toBe(0.10)
        expect(resolveVolumeTierRate(25_000)).toBe(0.12)
        expect(resolveVolumeTierRate(35_000)).toBe(0.15)
        expect(resolveVolumeTierRate(50_000)).toBe(0.20)
    })

    it('computeVolumeIncentive = scans × bracket rate (flat)', () => {
        expect(computeVolumeIncentive(8_000)).toBe(0)
        expect(computeVolumeIncentive(15_000)).toBe(1_500)
        expect(computeVolumeIncentive(25_000)).toBe(3_000)
        expect(computeVolumeIncentive(35_000)).toBe(5_250)
        expect(computeVolumeIncentive(50_000)).toBe(10_000)
    })

    it('computeVolumeIncentive respects Max Incentive / AM cap', () => {
        expect(computeVolumeIncentive(50_000, 5_000)).toBe(5_000)
        expect(computeVolumeIncentive(15_000, 0)).toBe(1_500)
    })

    it('resolvePointValueRmForVolume aligns point value with scan tier rate', () => {
        expect(resolvePointValueRmForVolume(15_000, 20)).toBe(0.005)
        expect(resolvePointValueRmForVolume(25_000, 20)).toBe(0.006)
        expect(resolvePointValueRmForVolume(8_000, 20)).toBe(0)
    })
})

describe('computeAmIncentiveEarnings (hybrid modes)', () => {
    const amRules = [
        { applies_to: 'all_ams' as const, achievement_threshold_percent: 100, incentive_amount: 200, status: 'active' },
        { applies_to: 'all_ams' as const, achievement_threshold_percent: 120, incentive_amount: 300, status: 'active' },
    ]

    it('volume_tiers mode uses scans × bracket rate', () => {
        const result = computeAmIncentiveEarnings('volume_tiers', {
            actualScans: 15_000,
            achievementPercent: 50,
            amRules,
        })
        expect(result.volumeTierRate).toBe(0.10)
        expect(result.incentiveEarned).toBe(1_500)
    })

    it('achievement_tiers mode uses highest met % tier', () => {
        const result = computeAmIncentiveEarnings('achievement_tiers', {
            actualScans: 15_000,
            achievementPercent: 125,
            amRules,
        })
        expect(result.volumeTierRate).toBeNull()
        expect(result.incentiveEarned).toBe(300)
    })
})

describe('incentives', () => {
    const rules = [
        { applies_to: 'all_ams' as const, achievement_threshold_percent: 100, incentive_amount: 200, status: 'active' },
        { applies_to: 'all_ams' as const, achievement_threshold_percent: 120, incentive_amount: 300, status: 'active' },
        { applies_to: 'all_ams' as const, achievement_threshold_percent: 140, incentive_amount: 400, status: 'active' },
        { applies_to: 'team_leader' as const, achievement_threshold_percent: 100, incentive_amount: 500, status: 'active' },
        { applies_to: 'team_leader' as const, achievement_threshold_percent: 120, incentive_amount: 800, status: 'active' },
    ]

    it('AM incentive: highest achieved tier wins (not stacked)', () => {
        expect(computeAmIncentive(rules, 99)).toBe(0)
        expect(computeAmIncentive(rules, 100)).toBe(200)
        expect(computeAmIncentive(rules, 125)).toBe(300)
        expect(computeAmIncentive(rules, 140)).toBe(400)
        expect(computeAmIncentive(rules, 999)).toBe(400) // capped at the top tier, never summed
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

    it('leader bonus is additive across met tiers on team achievement', () => {
        expect(computeLeaderBonus(rules, 99.9)).toBe(0)
        expect(computeLeaderBonus(rules, 100.5)).toBe(500)
        expect(computeLeaderBonus(rules, 125)).toBe(1300) // 500 + 800, additive
    })

    it('Max Incentive / AM caps the winning tier payout', () => {
        // Cap RM500: tiers 100=200, 120=300, 140=500. Nothing exceeds the cap.
        expect(computeAmIncentive(rules, 145, null, 500)).toBe(400) // top met tier RM400, under cap
        // A generous tier above the cap is clamped to the cap.
        const richer = [...rules, { applies_to: 'all_ams' as const, achievement_threshold_percent: 160, incentive_amount: 900, status: 'active' }]
        expect(computeAmIncentive(richer, 200, null, 500)).toBe(500) // clamped to cap
        expect(computeAmIncentive(richer, 200, null, 0)).toBe(900) // 0/undefined cap = no cap
        expect(computeAmIncentive(richer, 200, null)).toBe(900)
    })

    it('cap applies only to AM incentive; leader bonus stays additive and separate', () => {
        // An AM who leads: own AM incentive is capped, leader bonus is not.
        const amPart = computeAmIncentive(rules, 200, null, 250) // capped to 250 (would be 400)
        const leaderPart = computeLeaderBonus(rules, 125) // 500 + 800 = 1300, uncapped
        expect(amPart).toBe(250)
        expect(leaderPart).toBe(1300)
        expect(amPart + leaderPart).toBe(1550)
    })
})

describe('validateAmIncentiveTier (illogical payouts are blocked)', () => {
    const existing = [
        { id: 'a', achievement_threshold_percent: 100, incentive_amount: 200 },
        { id: 'b', achievement_threshold_percent: 120, incentive_amount: 300 },
    ]
    const CAP = 500

    it('accepts a valid, strictly-increasing, capped tier', () => {
        expect(validateAmIncentiveTier({ achievement_threshold_percent: 140, incentive_amount: 500 }, existing, CAP)).toBeNull()
    })

    it('rejects a threshold below 100%', () => {
        expect(validateAmIncentiveTier({ achievement_threshold_percent: 90, incentive_amount: 400 }, existing, CAP))
            .toBe('Achievement threshold must be at least 100%.')
    })

    it('rejects a non-positive amount', () => {
        expect(validateAmIncentiveTier({ achievement_threshold_percent: 150, incentive_amount: 0 }, existing, CAP))
            .toBe('Incentive amount must be greater than RM0.')
    })

    it('rejects an amount above the Max Incentive / AM cap', () => {
        expect(validateAmIncentiveTier({ achievement_threshold_percent: 140, incentive_amount: 600 }, existing, CAP))
            .toBe('Incentive cannot exceed the RM500 max incentive per AM.')
    })

    it('rejects a duplicate threshold', () => {
        expect(validateAmIncentiveTier({ achievement_threshold_percent: 120, incentive_amount: 350 }, existing, CAP))
            .toBe('A tier for 120% already exists.')
    })

    it('rejects a higher threshold that pays less than a lower tier (200% = RM100)', () => {
        expect(validateAmIncentiveTier({ achievement_threshold_percent: 200, incentive_amount: 100 }, existing, CAP))
            .toBe('Incentive for 200% must be higher than RM300 because it is above the 120% tier.')
    })

    it('rejects a lower threshold that pays more than a higher tier (110% = RM500)', () => {
        expect(validateAmIncentiveTier({ achievement_threshold_percent: 110, incentive_amount: 500 }, existing, CAP))
            .toBe('Incentive for 110% must be lower than RM300 because it is below the 120% tier.')
    })

    it('excludes the tier being edited from its own uniqueness/monotonicity checks', () => {
        // Editing tier "b" (120%) to RM350 is fine — it is not compared against itself.
        expect(validateAmIncentiveTier({ id: 'b', achievement_threshold_percent: 120, incentive_amount: 350 }, existing, CAP)).toBeNull()
    })

    it('no cap configured → cap check is skipped', () => {
        expect(validateAmIncentiveTier({ achievement_threshold_percent: 140, incentive_amount: 9000 }, existing, 0)).toBeNull()
    })
})

describe('attributeScans (multiple campaigns / AM takeover, no history rewrite)', () => {
    it('splits same-shop scans across campaigns by the snapshotted AM/team', () => {
        const teamIdByAm = new Map([['edi', 'team-1'], ['fitri', 'team-2']])
        // Same shop, two campaigns: Campaign A (AM Edi) then Campaign B (AM Fitri).
        const scans = [
            { account_manager_user_id: 'edi', campaign_id: 'camp-A' },
            { account_manager_user_id: 'edi', campaign_id: 'camp-A' },
            { account_manager_user_id: 'fitri', campaign_id: 'camp-B' },
        ]
        const { scansByAm, scansByCampaign, scansByCampaignTeam } = attributeScans(scans, teamIdByAm)
        expect(scansByAm.get('edi')).toBe(2)
        expect(scansByAm.get('fitri')).toBe(1)
        expect(scansByCampaign.get('camp-A')).toBe(2)
        expect(scansByCampaign.get('camp-B')).toBe(1)
        // Each campaign's scans aggregate to the team of its AM.
        expect(scansByCampaignTeam.get('camp-A')?.get('team-1')).toBe(2)
        expect(scansByCampaignTeam.get('camp-B')?.get('team-2')).toBe(1)
    })

    it('attribution follows each scan snapshot, not the AM’s later campaign', () => {
        // Edi later works Campaign B too, but historical Campaign A scans stay Edi's.
        const teamIdByAm = new Map([['edi', 'team-1'], ['fitri', 'team-2']])
        const scans = [
            { account_manager_user_id: 'edi', campaign_id: 'camp-A' }, // historical
            { account_manager_user_id: 'fitri', campaign_id: 'camp-B' }, // recovery AM
        ]
        const { scansByAm } = attributeScans(scans, teamIdByAm)
        expect(scansByAm.get('edi')).toBe(1)
        expect(scansByAm.get('fitri')).toBe(1)
    })

    it('ignores team aggregation for scans whose AM is unassigned', () => {
        const teamIdByAm = new Map([['edi', 'team-1']])
        const scans = [{ account_manager_user_id: 'ghost', campaign_id: 'camp-X' }]
        const { scansByAm, scansByCampaignTeam } = attributeScans(scans, teamIdByAm)
        expect(scansByAm.get('ghost')).toBe(1) // counted (surfaces as unassigned)
        expect(scansByCampaignTeam.get('camp-X')).toBeUndefined() // no team bucket
    })
})

describe('effectiveIncentiveRules (leader bonus optional)', () => {
    const rules = [
        { applies_to: 'all_ams' as const, achievement_threshold_percent: 100, incentive_amount: 200 },
        { applies_to: 'team_leader' as const, achievement_threshold_percent: 100, incentive_amount: 500 },
    ]

    it('keeps every rule when leader bonus is enabled', () => {
        expect(effectiveIncentiveRules(rules, true)).toHaveLength(2)
    })

    it('drops team_leader tiers when leader bonus is disabled (AM tiers untouched)', () => {
        const result = effectiveIncentiveRules(rules, false)
        expect(result).toHaveLength(1)
        expect(result.every((r) => r.applies_to === 'all_ams')).toBe(true)
        // With leader bonus off, a leader earns only their own AM incentive.
        expect(computeLeaderBonus(result, 150)).toBe(0)
    })
})

describe('resolveLeaderId (leader must be a selected member)', () => {
    it('keeps the leader while they remain a member', () => {
        expect(resolveLeaderId('edi', ['edi', 'fitri', 'kit'])).toBe('edi')
    })

    it('resets to no leader when removed from the member list', () => {
        expect(resolveLeaderId('edi', ['fitri', 'kit'])).toBe('')
        expect(resolveLeaderId('', ['edi'])).toBe('')
    })
})

describe('plan month helpers (report dropdown lists only configured months)', () => {
    it('addKpiMonths shifts across year boundaries', () => {
        expect(addKpiMonths('2026-01', -1)).toBe('2025-12')
        expect(addKpiMonths('2026-12', 1)).toBe('2027-01')
        expect(addKpiMonths('2026-05', 3)).toBe('2026-08')
    })

    it('compareKpiMonth orders months', () => {
        expect(compareKpiMonth('2026-05', '2026-06')).toBe(-1)
        expect(compareKpiMonth('2026-06', '2026-06')).toBe(0)
        expect(compareKpiMonth('2026-07', '2026-06')).toBe(1)
    })

    it('isMonthInEffectiveRange honours inclusive bounds and open-ended plans', () => {
        expect(isMonthInEffectiveRange('2026-05', '2026-05', '2026-08')).toBe(true)
        expect(isMonthInEffectiveRange('2026-08', '2026-05', '2026-08')).toBe(true)
        expect(isMonthInEffectiveRange('2026-04', '2026-05', '2026-08')).toBe(false)
        expect(isMonthInEffectiveRange('2026-09', '2026-05', '2026-08')).toBe(false)
        expect(isMonthInEffectiveRange('2030-01', '2026-05', null)).toBe(true) // open-ended
    })

    it('enumeratePlanMonths lists only months within the window, capped at the current month', () => {
        const now = new Date(2026, 6, 15) // local July 15 2026 (TZ-independent month/year)
        // Closed window entirely in the past → exactly its months, newest first.
        expect(enumeratePlanMonths('2026-05', '2026-07', now)).toEqual(['2026-07', '2026-06', '2026-05'])
        // Open-ended plan → capped at the current month, never future months.
        expect(enumeratePlanMonths('2026-05', null, now)).toEqual(['2026-07', '2026-06', '2026-05'])
        // A window that ends before it starts collapses to the single start month.
        expect(enumeratePlanMonths('2026-07', '2026-05', now)).toEqual(['2026-07'])
    })

    it('currentKpiMonth formats YYYY-MM', () => {
        expect(currentKpiMonth(new Date(2026, 6, 1))).toBe('2026-07')
    })
})

describe('event-derived month options (dropdown limited to event period / configured data)', () => {
    it('monthKeyFromDate extracts YYYY-MM from date strings', () => {
        expect(monthKeyFromDate('2026-07-01')).toBe('2026-07')
        expect(monthKeyFromDate('2026-12-31T16:00:00Z')).toBe('2026-12')
        expect(monthKeyFromDate(null)).toBeNull()
        expect(monthKeyFromDate('nonsense')).toBeNull()
    })

    it('enumerateMonthRange is inclusive ascending and order-tolerant', () => {
        expect(enumerateMonthRange('2026-07', '2026-12')).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'])
        expect(enumerateMonthRange('2026-12', '2026-07')).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'])
        expect(enumerateMonthRange('2026-05', '2026-05')).toEqual(['2026-05'])
    })

    it('enumerateMonthRange caps runaway ranges at 60 months', () => {
        // 5 years + 1 month would be 61 months; capped at 60.
        expect(enumerateMonthRange('2020-01', '2025-01')).toHaveLength(60)
    })
})

describe('deriveEffectiveFromOptions (short setup list — no long future months)', () => {
    it('active event → only previous/current/next month, never far-future months', () => {
        // Event = Road Tour For Ellbow, active (started July 2026), current month July.
        const opts = deriveEffectiveFromOptions({
            startDate: '2026-07-01',
            now: new Date(2026, 6, 15), // July 2026
        })
        expect(opts).toEqual(['2026-06', '2026-07', '2026-08'])
        // The bug: Sep 2026 … Apr 2027 must NOT appear.
        expect(opts.some((m) => ['2026-09', '2026-10', '2026-11', '2026-12'].includes(m))).toBe(false)
        expect(opts.some((m) => m.startsWith('2027'))).toBe(false)
    })

    it('long fixed-period event still shows only recent setup months (event period does not expand the From list)', () => {
        // Event runs July 2026 → June 2027, but From stays short.
        const opts = deriveEffectiveFromOptions({
            startDate: '2026-07-01',
            now: new Date(2026, 6, 15),
        })
        expect(opts).toEqual(['2026-06', '2026-07', '2026-08'])
    })

    it('future event start (beyond next month) is included so the plan can begin with the event', () => {
        const opts = deriveEffectiveFromOptions({
            startDate: '2026-11-01',
            now: new Date(2026, 6, 15), // July; event starts November
        })
        expect(opts).toEqual(['2026-06', '2026-07', '2026-08', '2026-11'])
    })

    it('unions configured plan from-months so an existing selection stays visible', () => {
        const opts = deriveEffectiveFromOptions({
            startDate: '2026-07-01',
            configuredMonths: ['2026-03'], // plan already starts before the recent window
            now: new Date(2026, 6, 15),
        })
        expect(opts).toEqual(['2026-03', '2026-06', '2026-07', '2026-08'])
    })
})

describe('deriveEffectiveToOptions (bounded by From and event end)', () => {
    it('fixed-period event → from up to the event end month (no months beyond the event)', () => {
        const opts = deriveEffectiveToOptions({ from: '2026-10', endDate: '2026-12-31' })
        expect(opts).toEqual(['2026-10', '2026-11', '2026-12'])
        expect(opts.some((m) => m.startsWith('2027'))).toBe(false)
    })

    it('every option is >= the selected Effective From', () => {
        const opts = deriveEffectiveToOptions({ from: '2026-10', endDate: '2026-12-31' })
        expect(opts.every((m) => compareKpiMonth(m, '2026-10') >= 0)).toBe(true)
    })

    it('event ending before From collapses to just the From month', () => {
        const opts = deriveEffectiveToOptions({ from: '2026-10', endDate: '2026-08-31' })
        expect(opts).toEqual(['2026-10'])
    })

    it('open-ended event → short list of From + next month only (no long future list)', () => {
        const opts = deriveEffectiveToOptions({ from: '2026-07', endDate: null })
        expect(opts).toEqual(['2026-07', '2026-08'])
    })

    it('unions configured endpoint months (>= from) so an existing To stays visible', () => {
        const opts = deriveEffectiveToOptions({ from: '2026-07', endDate: null, configuredMonths: ['2026-11'] })
        expect(opts).toEqual(['2026-07', '2026-08', '2026-11'])
    })
})
