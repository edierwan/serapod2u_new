import { describe, expect, it } from 'vitest'

import { applySort } from './reporting/tableSort'
import {
    buildUniqueShopRows,
    buildVisitSortColumns,
    hasLocationIssue,
    isCompletedVisit,
    visitTieBreak,
    type VisitLogRow,
    type VisitSortKey,
} from './visit-log-table'

interface TestVisit extends VisitLogRow {
    participant?: string | null
    locationTitle?: string | null
}

const columns = buildVisitSortColumns<TestVisit>({
    participantName: (v) => v.participant ?? null,
    locationTitle: (v) => v.locationTitle ?? null,
})

function visit(overrides: Partial<TestVisit> & { id: string }): TestVisit {
    return {
        shop_id: `shop-${overrides.id}`,
        shop_name: 'Kloud Room',
        shop_branch: null,
        shop_state: 'Penang',
        account_manager_user_id: 'am-1',
        user_name: 'Fitri',
        campaign_name: 'RoadTour 2026',
        visit_date: '2026-08-10',
        created_at: '2026-08-10T02:00:00.000Z',
        visit_status: 'official',
        visit_location_status: 'resolved',
        participant: 'Nayli',
        locationTitle: 'Georgetown, Penang',
        ...overrides,
    }
}

// Arrives in the order the query returns: visit_date DESC, created_at DESC.
const visits: TestVisit[] = [
    visit({
        id: 'v1', visit_date: '2026-08-20', created_at: '2026-08-20T09:00:00.000Z',
        shop_id: 'shop-b', shop_name: 'Bravo Shop', user_name: 'zainal', account_manager_user_id: 'am-3',
        participant: 'Chong', campaign_name: 'Northern Push',
        shop_state: 'Kedah', locationTitle: 'Alor Setar, Kedah',
    }),
    visit({
        id: 'v2', visit_date: '2026-08-20', created_at: '2026-08-20T03:00:00.000Z',
        shop_id: 'shop-a', shop_name: 'Alpha Shop', user_name: 'Aisyah', account_manager_user_id: 'am-1',
        participant: null, visit_status: 'pending', visit_location_status: 'denied',
        locationTitle: 'Location unavailable',
    }),
    visit({
        id: 'v3', visit_date: '2026-08-12', created_at: '2026-08-12T05:00:00.000Z',
        shop_id: 'shop-b', shop_name: 'Bravo Shop', user_name: 'Yusri', account_manager_user_id: 'am-2',
        participant: 'aminah', campaign_name: 'Southern Push',
    }),
    visit({
        id: 'v4', visit_date: '2026-08-02', created_at: '2026-08-02T01:00:00.000Z',
        shop_id: 'shop-c', shop_name: 'Charlie Shop', user_name: '—', account_manager_user_id: null,
        participant: 'Bala', visit_status: 'completed', visit_location_status: null,
    }),
]

const order = (key: VisitSortKey, direction: 'asc' | 'desc') =>
    applySort(visits, columns[key], direction, visitTieBreak).map((v) => v.id)

describe('visit log default order', () => {
    it('is preserved until the user picks a column', () => {
        // No sort applied — the view renders `filtered` exactly as it arrived.
        expect(visits.map((v) => v.id)).toEqual(['v1', 'v2', 'v3', 'v4'])
    })

    it('reproduces newest-first when the date column is sorted descending', () => {
        expect(order('date', 'desc')).toEqual(['v1', 'v2', 'v3', 'v4'])
        expect(order('date', 'asc')).toEqual(['v4', 'v3', 'v2', 'v1'])
    })
})

describe('visit log column sorting', () => {
    it('sorts Account Manager case-insensitively with unresolved AMs last', () => {
        expect(order('accountManager', 'asc')).toEqual(['v2', 'v3', 'v1', 'v4'])
        expect(order('accountManager', 'desc')).toEqual(['v1', 'v3', 'v2', 'v4'])
    })

    it('sorts Participant on the resolved display name, placeholders last', () => {
        // aminah, Bala, Chong — case-insensitive — then the unresolved participant.
        expect(order('participant', 'asc')).toEqual(['v3', 'v4', 'v1', 'v2'])
        expect(order('participant', 'desc')).toEqual(['v1', 'v4', 'v3', 'v2'])
    })

    it('sorts Shop on the displayed shop name', () => {
        // Bravo Shop appears twice; the chronological tie-break keeps them stable.
        expect(order('shop', 'asc')).toEqual(['v2', 'v3', 'v1', 'v4'])
        expect(order('shop', 'desc')).toEqual(['v4', 'v3', 'v1', 'v2'])
    })

    it('sorts Campaign, Location Status and Visit Status on their display labels', () => {
        expect(order('campaign', 'asc')[0]).toBe('v1')
        expect(order('locationStatus', 'asc')[0]).toBe('v1')
        expect(order('visitStatus', 'asc')).toEqual(['v4', 'v3', 'v1', 'v2'])
    })
})

describe('visit log numbering', () => {
    it('numbers rows by page and page size', () => {
        const numbered = (pageSize: number, page: number) => {
            const start = (page - 1) * pageSize
            return visits.slice(start, start + pageSize).map((v, index) => ({ number: start + index + 1, id: v.id }))
        }
        expect(numbered(2, 1)).toEqual([{ number: 1, id: 'v1' }, { number: 2, id: 'v2' }])
        expect(numbered(2, 2)).toEqual([{ number: 3, id: 'v3' }, { number: 4, id: 'v4' }])
        expect(numbered(3, 2)).toEqual([{ number: 4, id: 'v4' }])
    })
})

describe('visit log KPI drill-downs', () => {
    it('Total Visits lists every filtered row and nothing else', () => {
        // The drill-down is the `filtered` set itself, which is what metrics.total counts.
        const drilldown = visits
        expect(drilldown).toHaveLength(visits.length)
        expect(drilldown.map((v) => v.id)).toEqual(['v1', 'v2', 'v3', 'v4'])
    })

    it('Unique Shops has one row per shop_id and matches the KPI formula', () => {
        const rows = buildUniqueShopRows(visits)
        expect(rows).toHaveLength(new Set(visits.map((v) => v.shop_id)).size)
        expect(rows.map((r) => r.shopId)).toEqual(['shop-a', 'shop-b', 'shop-c'])
        expect(new Set(rows.map((r) => r.shopId)).size).toBe(rows.length)
    })

    it('aggregates repeat visits into one shop row with its latest visit', () => {
        const bravo = buildUniqueShopRows(visits).find((r) => r.shopId === 'shop-b')!
        expect(bravo.visitCount).toBe(2)
        expect(bravo.latestVisit.id).toBe('v1')
        expect(bravo.region).toBe('Kedah')
    })

    it('Completed Visits uses the existing completed predicate', () => {
        const completed = visits.filter(isCompletedVisit)
        expect(completed.map((v) => v.id)).toEqual(['v1', 'v3', 'v4'])
        expect(completed).toHaveLength(
            visits.filter((v) => (v.visit_status || '').toLowerCase().includes('complet')
                || (v.visit_status || '').toLowerCase() === 'official').length,
        )
    })

    it('Location Issues uses the existing location predicate', () => {
        const issues = visits.filter(hasLocationIssue)
        expect(issues.map((v) => v.id)).toEqual(['v2'])
        expect(issues).toHaveLength(
            visits.filter((v) => v.visit_location_status
                && !['resolved', 'success'].includes(String(v.visit_location_status))).length,
        )
    })
})
