// Sorting and KPI semantics for the Visit Log table.
//
// The KPI cards and their drill-downs both read the predicates here, so a card
// can never disagree with the dialog it opens. The formulas themselves are the
// ones the Visit Log already used — this module only names them once.

import { compareText, type SortColumn } from './reporting/tableSort'

/** The fields the Visit Log table sorts, counts and groups on. */
export interface VisitLogRow {
    id: string
    shop_id: string
    shop_name?: string | null
    shop_branch?: string | null
    shop_state?: string | null
    account_manager_user_id?: string | null
    user_name?: string | null
    campaign_name?: string | null
    visit_date: string
    created_at: string
    visit_status: string
    visit_location_status?: string | null
}

const UNRESOLVED_PLACEHOLDER = '—'

/** The one definition of a completed visit. */
export function isCompletedVisit(visit: VisitLogRow): boolean {
    const status = (visit.visit_status || '').toLowerCase()
    return status.includes('complet') || status === 'official'
}

/** The one definition of a location issue. */
export function hasLocationIssue(visit: VisitLogRow): boolean {
    return Boolean(visit.visit_location_status)
        && !['resolved', 'success'].includes(String(visit.visit_location_status))
}

export function hasResolvedAccountManager(visit: VisitLogRow): boolean {
    return Boolean(visit.account_manager_user_id)
        && Boolean(visit.user_name)
        && visit.user_name !== UNRESOLVED_PLACEHOLDER
}

export function visitOutcomeForRow(visit: VisitLogRow): {
    label: string
    tone: 'emerald' | 'amber' | 'red' | 'slate'
} {
    const status = (visit.visit_status || '').toLowerCase()
    const locStatus = String(visit.visit_location_status || '').toLowerCase()
    if (locStatus && !['resolved', 'success', ''].includes(locStatus)) return { label: 'Location Issue', tone: 'amber' }
    if (status === 'official' || status.includes('complet')) return { label: 'Completed', tone: 'emerald' }
    if (status.includes('reject') || status.includes('fail')) return { label: 'Failed', tone: 'red' }
    return { label: visit.visit_status || UNRESOLVED_PLACEHOLDER, tone: 'slate' }
}

/** Orders a visit the way the query does: visit date first, then capture time. */
export function visitChronologyKey(visit: VisitLogRow): string {
    return `${visit.visit_date}|${visit.created_at}`
}

export const visitTieBreak = (visit: VisitLogRow) => `${visitChronologyKey(visit)}|${visit.id}`

export type VisitSortKey =
    | 'date' | 'accountManager' | 'participant' | 'shop' | 'campaign' | 'locationStatus' | 'visitStatus'

/**
 * Each column sorts on the value the row actually displays, so the participant
 * and location accessors are supplied by the view that renders them.
 */
export function buildVisitSortColumns<Row extends VisitLogRow>(options: {
    participantName: (row: Row) => string | null
    locationTitle: (row: Row) => string | null
}): Record<VisitSortKey, SortColumn<Row>> {
    return {
        date: {
            value: visitChronologyKey,
            compare: (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
        },
        accountManager: { value: (row) => (hasResolvedAccountManager(row) ? row.user_name : null) },
        participant: { value: options.participantName },
        shop: { value: (row) => row.shop_name },
        campaign: { value: (row) => row.campaign_name },
        locationStatus: { value: options.locationTitle },
        visitStatus: { value: (row) => visitOutcomeForRow(row).label },
    }
}

export interface UniqueShopRow<Row extends VisitLogRow = VisitLogRow> {
    shopId: string
    shopName: string
    region: string | null
    latestVisit: Row
    visitCount: number
}

/**
 * One row per `shop_id` — the Unique Shops KPI counts shops, not visits, so its
 * drill-down must too. The KPI formula itself is unchanged.
 */
export function buildUniqueShopRows<Row extends VisitLogRow>(visits: Row[]): UniqueShopRow<Row>[] {
    const regionOf = (visit: Row) => [visit.shop_branch, visit.shop_state].filter(Boolean).join(', ') || null
    const byShop = new Map<string, UniqueShopRow<Row>>()

    for (const visit of visits) {
        const shopId = String(visit.shop_id)
        const existing = byShop.get(shopId)
        if (!existing) {
            byShop.set(shopId, {
                shopId,
                shopName: visit.shop_name || UNRESOLVED_PLACEHOLDER,
                region: regionOf(visit),
                latestVisit: visit,
                visitCount: 1,
            })
            continue
        }
        existing.visitCount += 1
        if (visitChronologyKey(visit) > visitChronologyKey(existing.latestVisit)) {
            existing.latestVisit = visit
            existing.shopName = visit.shop_name || existing.shopName
            existing.region = regionOf(visit) ?? existing.region
        }
    }

    return Array.from(byShop.values())
        .sort((a, b) => compareText(a.shopName, b.shopName) || compareText(a.shopId, b.shopId))
}
