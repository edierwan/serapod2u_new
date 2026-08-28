import { describe, expect, it } from 'vitest'

import {
    buildFollowUpSummary,
    buildShopEntries,
    selectFollowUpKpiEntries,
    sortFollowUpQueue,
} from './aggregate'
import { orderFollowUpQueue } from './followUpTable'
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

    return { ...base, ...overrides, matured, outcome: overrides.outcome ?? base.outcome }
}

const rows = [
    // Unassigned high priority — the business default must keep this first.
    row({
        visit_id: 'r1', shop_id: 'shop-zulu', shop_name: 'Zulu Shop', shop_name_primary: 'Zulu Shop',
        shop_region: 'Johor', visit_at: '2026-08-05T02:00:00.000Z',
        account_manager_user_id: null, account_manager_name: null,
        before_scans: 3, after_scans: 0, last_scan_after_at: null,
    }),
    row({
        visit_id: 'r2', shop_id: 'shop-alpha', shop_name: 'Alpha Shop', shop_name_primary: 'Alpha Shop',
        shop_region: 'Penang', visit_at: '2026-08-04T02:00:00.000Z',
        account_manager_user_id: 'am-2', account_manager_name: 'Yusri',
        before_scans: 4, after_scans: 0, last_scan_after_at: null,
    }),
    row({
        visit_id: 'r3', shop_id: 'shop-bravo', shop_name: 'Bravo Shop', shop_name_primary: 'Bravo Shop',
        shop_region: 'Selangor', visit_at: '2026-08-10T02:00:00.000Z',
        account_manager_user_id: 'am-1', account_manager_name: 'Aisyah',
        before_scans: 4, after_scans: 1, last_scan_after_at: '2026-08-15T04:00:00.000Z',
    }),
    row({
        visit_id: 'r4', shop_id: 'shop-charlie', shop_name: 'Charlie Shop', shop_name_primary: 'Charlie Shop',
        shop_region: 'Kedah', visit_at: '2026-08-11T02:00:00.000Z',
        account_manager_user_id: 'am-3', account_manager_name: 'zainal',
        before_scans: 2, after_scans: 9, last_scan_after_at: '2026-08-20T04:00:00.000Z',
    }),
    // Still observing — no drop, no due date pressure.
    row({
        visit_id: 'r5', shop_id: 'shop-delta', shop_name: 'Delta Shop', shop_name_primary: 'Delta Shop',
        shop_region: null, visit_at: '2026-08-27T02:00:00.000Z',
        account_manager_user_id: 'am-2', account_manager_name: 'Yusri',
        before_scans: 0, after_scans: 0,
    }),
]

const entries = buildShopEntries(rows, NOW)

describe('follow-up queue ordering', () => {
    it('keeps the business default order until a column is chosen', () => {
        expect(orderFollowUpQueue(entries, null).map((e) => e.shopName))
            .toEqual(sortFollowUpQueue(entries).map((e) => e.shopName))
        expect(orderFollowUpQueue(entries, null)[0].shopName).toBe('Zulu Shop')
    })

    it('sorts Responsible AM ascending and descending, unassigned last in both', () => {
        const asc = orderFollowUpQueue(entries, { key: 'am', direction: 'asc' })
        expect(asc.map((e) => e.ownerAmName)).toEqual(['Aisyah', 'Yusri', 'Yusri', 'zainal', null])

        const desc = orderFollowUpQueue(entries, { key: 'am', direction: 'desc' })
        expect(desc.map((e) => e.ownerAmName)).toEqual(['zainal', 'Yusri', 'Yusri', 'Aisyah', null])
    })

    it('ranks Priority by business order, not alphabetically', () => {
        const asc = orderFollowUpQueue(entries, { key: 'priority', direction: 'asc' })
        expect(asc.map((e) => e.priority)).toEqual(['high', 'high', 'high', 'observing', 'healthy'])

        const desc = orderFollowUpQueue(entries, { key: 'priority', direction: 'desc' })
        expect(desc.map((e) => e.priority)).toEqual(['healthy', 'observing', 'high', 'high', 'high'])
    })

    it('sorts Last Visit chronologically', () => {
        const asc = orderFollowUpQueue(entries, { key: 'lastVisit', direction: 'asc' })
        expect(asc.map((e) => e.currentRow.visit_date))
            .toEqual(['2026-08-04', '2026-08-05', '2026-08-10', '2026-08-11', '2026-08-27'])
        expect(orderFollowUpQueue(entries, { key: 'lastVisit', direction: 'desc' })[0].currentRow.visit_date)
            .toBe('2026-08-27')
    })

    it('sorts Last Valid Scan chronologically and sinks shops that never scanned', () => {
        const asc = orderFollowUpQueue(entries, { key: 'lastScan', direction: 'asc' })
        expect(asc.slice(0, 2).map((e) => e.shopName)).toEqual(['Bravo Shop', 'Charlie Shop'])
        expect(asc.slice(2).every((e) => !(e.attributedRow ?? e.currentRow).last_scan_after_at)).toBe(true)
    })

    it('sorts Follow-Up Due chronologically', () => {
        const due = orderFollowUpQueue(entries, { key: 'due', direction: 'asc' }).map((e) => e.dueDate)
        expect([...due]).toEqual([...due].sort())
    })

    it('sorts Region and Shop case-insensitively with missing regions last', () => {
        expect(orderFollowUpQueue(entries, { key: 'shop', direction: 'asc' }).map((e) => e.shopNamePrimary))
            .toEqual(['Alpha Shop', 'Bravo Shop', 'Charlie Shop', 'Delta Shop', 'Zulu Shop'])
        expect(orderFollowUpQueue(entries, { key: 'region', direction: 'asc' }).at(-1)!.region).toBeNull()
    })
})

describe('filtered + sorted pagination numbering', () => {
    const PAGE_SIZE = 2

    it('numbers rows by their position in the filtered, sorted queue', () => {
        const actionable = entries.filter((e) => e.priority === 'high' || e.priority === 'medium')
        const queue = orderFollowUpQueue(actionable, { key: 'shop', direction: 'asc' })

        const numbered = (page: number) => queue
            .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
            .map((entry, index) => ({ number: page * PAGE_SIZE + index + 1, shop: entry.shopNamePrimary }))

        expect(numbered(0)).toEqual([
            { number: 1, shop: 'Alpha Shop' },
            { number: 2, shop: 'Bravo Shop' },
        ])
        // Page two continues the count instead of restarting at 1.
        expect(numbered(1)).toEqual([{ number: 3, shop: 'Zulu Shop' }])
    })
})

describe('follow-up KPI drill-downs', () => {
    const summary = buildFollowUpSummary(entries)

    it('shows exactly the records each KPI counted', () => {
        expect(selectFollowUpKpiEntries(entries, 'highPriority')).toHaveLength(summary.highPriority)
        expect(selectFollowUpKpiEntries(entries, 'dueToday')).toHaveLength(summary.dueToday)
        expect(selectFollowUpKpiEntries(entries, 'overdue')).toHaveLength(summary.overdue)
        expect(selectFollowUpKpiEntries(entries, 'unassignedShops')).toHaveLength(summary.unassignedShops)
    })

    it('derives each list from the KPI definition itself', () => {
        expect(selectFollowUpKpiEntries(entries, 'highPriority').every((e) => e.priority === 'high')).toBe(true)
        expect(selectFollowUpKpiEntries(entries, 'unassignedShops').map((e) => e.shopName)).toEqual(['Zulu Shop'])
        expect(selectFollowUpKpiEntries(entries, 'overdue').every((e) => e.dueState === 'overdue')).toBe(true)
    })
})
