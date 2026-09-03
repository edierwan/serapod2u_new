import { describe, expect, it } from 'vitest'

import {
    buildAmPerformance,
    buildFollowUpSummary,
    buildManagementInsights,
    buildOverviewSummary,
    buildShopEntries,
    isOverdueFollowUp,
    MIN_MATURED_SAMPLE_FOR_RANKING,
    sortFollowUpQueue,
} from './aggregate'
import { attributeShopVisits, findOverlappingObservationWindows } from './attribution'
import { classifyShopOutcome, computeScanLiftPercent, observationMaturesAt } from './impactModel'
import type { RoadtourVisitReportRow } from './types'

const NOW = new Date('2026-08-28T01:00:00Z') // 28 Aug 2026, Malaysia
const WINDOW = 7

let sequence = 0

function row(overrides: Partial<RoadtourVisitReportRow> & { visit_at: string }): RoadtourVisitReportRow {
    sequence += 1
    const visitAt = overrides.visit_at
    const matured = overrides.matured ?? NOW.getTime() >= observationMaturesAt(visitAt, WINDOW)
    const before = overrides.before_scans ?? 0
    const after = overrides.after_scans ?? 0

    const base: RoadtourVisitReportRow = {
        visit_id: `visit-${sequence}`,
        visit_date: visitAt.slice(0, 10),
        visit_at: visitAt,
        visit_at_from_official_scan: true,
        campaign_id: 'campaign-1',
        campaign_name: 'RoadTour 2026',
        account_manager_user_id: 'am-1',
        account_manager_name: 'Fitri',
        shop_id: 'shop-1',
        shop_name: 'Kloud Room',
        shop_name_primary: 'Kloud Room',
        shop_branch_label: null,
        shop_code: null,
        shop_region: 'Penang',
        shop_state_id: 'state-1',
        participant_count: 1,
        latest_participant_name: 'Nayli',
        latest_participant_phone: '+60145600453',
        before_scans: before,
        after_scans: after,
        scan_lift: after - before,
        scan_lift_percent: computeScanLiftPercent(before, after),
        window_days: WINDOW,
        matured,
        matures_at: new Date(observationMaturesAt(visitAt, WINDOW)).toISOString(),
        days_since_visit: 0,
        outcome: classifyShopOutcome({ beforeScans: before, afterScans: after, matured }),
        first_scan_after_at: null,
        last_scan_after_at: null,
        is_current_for_shop: false,
        is_attributed_for_shop: false,
        notes: null,
    }

    // Keep the derived fields consistent with whatever counts the test supplied.
    return { ...base, ...overrides, matured, outcome: overrides.outcome ?? base.outcome }
}

describe('repeated visits to the same shop', () => {
    const early = row({
        visit_id: 'early', visit_at: '2026-08-02T02:00:00.000Z',
        account_manager_user_id: 'am-1', account_manager_name: 'Fitri',
        before_scans: 4, after_scans: 0,
    })
    const late = row({
        visit_id: 'late', visit_at: '2026-08-12T02:00:00.000Z',
        account_manager_user_id: 'am-2', account_manager_name: 'Yusri',
        before_scans: 2, after_scans: 9,
    })

    it('credits the shop outcome to the latest matured visit only', () => {
        const attribution = attributeShopVisits([early, late].map((r) => ({
            visit_id: r.visit_id, shop_id: r.shop_id, visit_at: r.visit_at, matured: r.matured, window_days: r.window_days,
        })))
        const shop = attribution.get('shop-1')!
        expect(shop.visitCount).toBe(2)
        expect(shop.currentRow.visit_id).toBe('late')
        expect(shop.attributedRow?.visit_id).toBe('late')
    })

    it('counts the shop once, never once per account manager', () => {
        const entries = buildShopEntries([early, late], NOW)
        expect(entries).toHaveLength(1)

        const performance = buildAmPerformance(entries, [early, late])
        expect(performance.rows).toHaveLength(1)
        expect(performance.rows[0].amId).toBe('am-2')
        expect(performance.rows[0].shopsVisited).toBe(1)
        expect(performance.teamShopsVisited).toBe(1)
    })

    it('makes the latest visit the responsible owner for follow-up', () => {
        const entries = buildShopEntries([early, late], NOW)
        expect(entries[0].ownerAmName).toBe('Yusri')
        expect(entries[0].outcome).toBe('improved')
    })

    it('falls back to the latest matured visit when the newest one is still pending', () => {
        const pending = row({
            visit_id: 'pending', visit_at: '2026-08-26T02:00:00.000Z',
            account_manager_user_id: 'am-3', account_manager_name: 'Safwan',
            before_scans: 0, after_scans: 0,
        })
        expect(pending.matured).toBe(false)

        const entries = buildShopEntries([early, pending], NOW)
        expect(entries[0].ownerAmName).toBe('Safwan')          // latest visit owns the shop today
        expect(entries[0].creditedAmName).toBe('Fitri')        // latest MATURED visit owns the outcome
        expect(entries[0].outcome).toBe('no_response')
    })

    it('reports a shop with only pending visits as pending observation', () => {
        const pendingOnly = row({ visit_at: '2026-08-25T02:00:00.000Z', before_scans: 3, after_scans: 1 })
        const entries = buildShopEntries([pendingOnly], NOW)
        expect(entries[0].matured).toBe(false)
        expect(entries[0].outcome).toBe('pending_observation')
        expect(entries[0].priority).toBe('observing')
    })
})

describe('overlapping observation windows', () => {
    it('detects revisits whose before/after windows overlap', () => {
        const first = row({ visit_id: 'a', visit_at: '2026-08-02T02:00:00.000Z' })
        const overlapping = row({ visit_id: 'b', visit_at: '2026-08-05T02:00:00.000Z' })
        const separate = row({ visit_id: 'c', visit_at: '2026-08-20T02:00:00.000Z' })

        const overlaps = findOverlappingObservationWindows(
            [first, overlapping, separate].map((r) => ({
                visit_id: r.visit_id, shop_id: r.shop_id, visit_at: r.visit_at, matured: r.matured, window_days: r.window_days,
            })),
        )
        expect(overlaps).toHaveLength(1)
        expect(overlaps[0][0].visit_id).toBe('a')
        expect(overlaps[0][1].visit_id).toBe('b')
    })

    it('still produces exactly one outcome for the shop', () => {
        const first = row({ visit_id: 'a', visit_at: '2026-08-02T02:00:00.000Z', before_scans: 1, after_scans: 5 })
        const overlapping = row({ visit_id: 'b', visit_at: '2026-08-05T02:00:00.000Z', before_scans: 3, after_scans: 5 })
        const entries = buildShopEntries([first, overlapping], NOW)
        expect(entries).toHaveLength(1)
        expect(entries[0].attributedRow?.visit_id).toBe('b')
    })
})

describe('unassigned visits', () => {
    const unassigned = row({
        visit_id: 'u1', shop_id: 'shop-9', shop_name: 'Unknown Owner Shop', shop_name_primary: 'Unknown Owner Shop',
        visit_at: '2026-08-02T02:00:00.000Z',
        account_manager_user_id: null, account_manager_name: null,
        before_scans: 0, after_scans: 6,
    })
    const assigned = row({
        visit_id: 'a1', shop_id: 'shop-2', visit_at: '2026-08-03T02:00:00.000Z',
        before_scans: 2, after_scans: 1,
    })

    it('never lets an unassigned group appear as an account manager', () => {
        const entries = buildShopEntries([unassigned, assigned], NOW)
        const performance = buildAmPerformance(entries, [unassigned, assigned])

        expect(performance.rows.map((r) => r.amId)).toEqual(['am-1'])
        expect(performance.rows.every((r) => r.amId !== null && r.amName !== 'Unassigned')).toBe(true)
        expect(performance.rows[0].rank).not.toBe(1) // one matured shop is below the ranking sample
    })

    it('surfaces unassigned work as a counted exception instead', () => {
        const entries = buildShopEntries([unassigned, assigned], NOW)
        const performance = buildAmPerformance(entries, [unassigned, assigned])
        expect(performance.unassignedVisits).toBe(1)
        expect(performance.unassignedShops).toBe(1)
    })

    it('asks for an owner before any other action', () => {
        const entries = buildShopEntries([unassigned], NOW)
        expect(entries[0].action).toBe('Assign AM')
    })
})

describe('AM performance denominators and ranking', () => {
    function shopsFor(amId: string, amName: string, outcomes: Array<{ before: number; after: number }>, prefix: string) {
        return outcomes.map((counts, index) => row({
            visit_id: `${prefix}-${index}`,
            shop_id: `${prefix}-shop-${index}`,
            shop_name: `${prefix} shop ${index}`,
            shop_name_primary: `${prefix} shop ${index}`,
            visit_at: '2026-08-05T02:00:00.000Z',
            account_manager_user_id: amId,
            account_manager_name: amName,
            before_scans: counts.before,
            after_scans: counts.after,
        }))
    }

    // Lucky: one matured shop that responded → a perfect 100% on a sample of one.
    const lucky = shopsFor('am-lucky', 'Lucky', [{ before: 0, after: 3 }], 'lucky')
    // Solid: four matured shops, three responded → 75% on a real sample.
    const solid = shopsFor('am-solid', 'Solid', [
        { before: 1, after: 4 }, { before: 0, after: 2 }, { before: 3, after: 3 }, { before: 2, after: 0 },
    ], 'solid')

    const rows = [...lucky, ...solid]
    const entries = buildShopEntries(rows, NOW)
    const performance = buildAmPerformance(entries, rows)

    it('requires a reasonable matured sample before a rate can rank', () => {
        expect(MIN_MATURED_SAMPLE_FOR_RANKING).toBe(3)
        const ranked = performance.rows.filter((r) => r.rank !== null)
        expect(ranked.map((r) => r.amName)).toEqual(['Solid'])
    })

    it('does not let one responding shop top the leaderboard', () => {
        expect(performance.rows[0].amName).toBe('Solid')
        const luckyRow = performance.rows.find((r) => r.amName === 'Lucky')!
        expect(luckyRow.rank).toBeNull()
        expect(luckyRow.hasRankableSample).toBe(false)
        expect(luckyRow.responseRate).toBe(1)
        expect(luckyRow.maturedShops).toBe(1)
    })

    it('keeps the matured sample visible beside every rate', () => {
        const solidRow = performance.rows.find((r) => r.amName === 'Solid')!
        expect(solidRow.maturedShops).toBe(4)
        expect(solidRow.respondedShops).toBe(3)
        expect(solidRow.responseRate).toBe(0.75)
        expect(solidRow.noResponseShops).toBe(1)
        expect(solidRow.improvedOrActivatedShops).toBe(2)
    })

    it('excludes pending shops from the response-rate denominator', () => {
        const pending = row({
            visit_id: 'pending-1', shop_id: 'pending-shop', shop_name: 'Pending shop', shop_name_primary: 'Pending shop',
            visit_at: '2026-08-26T02:00:00.000Z',
            account_manager_user_id: 'am-solid', account_manager_name: 'Solid',
            before_scans: 0, after_scans: 0,
        })
        const withPending = [...rows, pending]
        const pendingEntries = buildShopEntries(withPending, NOW)
        const pendingPerformance = buildAmPerformance(pendingEntries, withPending)
        const solidRow = pendingPerformance.rows.find((r) => r.amName === 'Solid')!

        expect(solidRow.shopsVisited).toBe(5)
        expect(solidRow.maturedShops).toBe(4)
        expect(solidRow.responseRate).toBe(0.75)
        expect(solidRow.noResponseShops).toBe(1)
    })
})

describe('monthly overview summary', () => {
    const rows = [
        row({ visit_id: 'o1', shop_id: 's1', shop_name: 'A', shop_name_primary: 'A', visit_at: '2026-08-03T02:00:00.000Z', before_scans: 0, after_scans: 4 }),
        row({ visit_id: 'o2', shop_id: 's2', shop_name: 'B', shop_name_primary: 'B', visit_at: '2026-08-04T02:00:00.000Z', before_scans: 6, after_scans: 1 }),
        row({ visit_id: 'o3', shop_id: 's3', shop_name: 'C', shop_name_primary: 'C', visit_at: '2026-08-05T02:00:00.000Z', before_scans: 3, after_scans: 0 }),
        row({ visit_id: 'o4', shop_id: 's4', shop_name: 'D', shop_name_primary: 'D', visit_at: '2026-08-26T02:00:00.000Z', before_scans: 0, after_scans: 0 }),
    ]
    const entries = buildShopEntries(rows, NOW)
    const summary = buildOverviewSummary(entries, rows)

    it('separates visited shops from matured shops', () => {
        expect(summary.shopsVisited).toBe(4)
        expect(summary.maturedShops).toBe(3)
        expect(summary.pendingObservationShops).toBe(1)
        expect(summary.pendingObservationVisits).toBe(1)
    })

    it('measures conversion against the matured denominator', () => {
        expect(summary.respondingShops).toBe(2)
        expect(summary.visitToScanConversion).toBeCloseTo(2 / 3, 10)
    })

    it('counts dropped and no-response shops as needing follow-up', () => {
        expect(summary.outcomeCounts.newly_activated).toBe(1)
        expect(summary.outcomeCounts.dropped).toBe(1)
        expect(summary.outcomeCounts.no_response).toBe(1)
        expect(summary.outcomeCounts.pending_observation).toBe(1)
        // Dropped + No Response, plus the newly-activated shop whose nurture action is overdue.
        expect(summary.shopsRequiringFollowUp).toBe(3)
    })

    it('reports no conversion at all when nothing has matured', () => {
        const pendingOnly = [row({ visit_id: 'p', shop_id: 'sp', visit_at: '2026-08-27T02:00:00.000Z' })]
        const pendingSummary = buildOverviewSummary(buildShopEntries(pendingOnly, NOW), pendingOnly)
        expect(pendingSummary.visitToScanConversion).toBeNull()
    })

    it('agrees in number for a single shop', () => {
        const single = [row({ visit_id: 'single', shop_id: 'only', visit_at: '2026-08-03T02:00:00.000Z', before_scans: 2, after_scans: 0 })]
        const singleEntries = buildShopEntries(single, NOW)
        const singleSummary = buildOverviewSummary(singleEntries, single)
        expect(buildManagementInsights(singleEntries, singleSummary, buildAmPerformance(singleEntries, single))[0])
            .toBe('1 shop requires follow-up; 1 is assigned to Fitri.')
    })

    it('derives at most two insights, all from the calculations', () => {
        const insights = buildManagementInsights(entries, summary, buildAmPerformance(entries, rows))
        expect(insights).toHaveLength(2)
        expect(insights[0]).toBe('3 shops require follow-up; 3 are assigned to Fitri.')
        expect(insights[1]).toBe('1 visit is still pending the full 7-day observation window.')
    })
})

describe('follow-up queue ordering', () => {
    const unassignedHigh = row({
        visit_id: 'q1', shop_id: 'q-shop-1', shop_name: 'Zulu Shop', shop_name_primary: 'Zulu Shop',
        visit_at: '2026-08-05T02:00:00.000Z',
        account_manager_user_id: null, account_manager_name: null,
        before_scans: 2, after_scans: 0,
    })
    const assignedHigh = row({
        visit_id: 'q2', shop_id: 'q-shop-2', shop_name: 'Alpha Shop', shop_name_primary: 'Alpha Shop',
        visit_at: '2026-08-04T02:00:00.000Z', before_scans: 2, after_scans: 0,
    })
    const healthy = row({
        visit_id: 'q3', shop_id: 'q-shop-3', shop_name: 'Bravo Shop', shop_name_primary: 'Bravo Shop',
        visit_at: '2026-08-04T02:00:00.000Z', before_scans: 2, after_scans: 9,
    })
    const observing = row({
        visit_id: 'q4', shop_id: 'q-shop-4', shop_name: 'Charlie Shop', shop_name_primary: 'Charlie Shop',
        visit_at: '2026-08-27T02:00:00.000Z', before_scans: 0, after_scans: 0,
    })

    const entries = buildShopEntries([healthy, assignedHigh, observing, unassignedHigh], NOW)
    const queue = sortFollowUpQueue(entries)

    it('puts unassigned high-priority shops first', () => {
        expect(queue[0].shopName).toBe('Zulu Shop')
        expect(queue[0].ownerAmId).toBeNull()
        expect(queue[1].shopName).toBe('Alpha Shop')
    })

    it('keeps observing shops out of the actionable band but still in the queue', () => {
        const observingEntry = queue.find((entry) => entry.shopName === 'Charlie Shop')!
        expect(observingEntry.priority).toBe('observing')
        expect(isOverdueFollowUp(observingEntry)).toBe(false)
        expect(queue.map((e) => e.priority)).toContain('observing')
    })

    it('summarises the queue for the KPI row', () => {
        const summary = buildFollowUpSummary(entries)
        expect(summary.highPriority).toBe(2)
        expect(summary.unassignedShops).toBe(1)
        expect(summary.overdue).toBe(2)
        expect(summary.dueToday).toBe(0)
    })
})
