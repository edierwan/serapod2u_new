// Column semantics for the Shop Follow-Up queue table.
//
// The queue's default order is the business one in `sortFollowUpQueue()`; this
// module only describes how each column sorts once the user picks one.

import {
    FOLLOW_UP_PRIORITY_WEIGHT,
    sortFollowUpQueue,
    type ShopReportEntry,
} from './aggregate'
import { OUTCOME_LABEL } from './impactModel'
import { applySort, compareDate, type SortColumn, type SortState } from './tableSort'

export type FollowUpSortKey =
    | 'priority' | 'shop' | 'region' | 'am' | 'lastVisit'
    | 'observation' | 'lastScan' | 'action' | 'due'

/**
 * Priority ranks on the business weight rather than alphabetically, and the
 * date columns compare chronologically rather than as formatted text.
 */
export const FOLLOW_UP_SORT_COLUMNS: Record<FollowUpSortKey, SortColumn<ShopReportEntry>> = {
    priority: { value: (entry) => FOLLOW_UP_PRIORITY_WEIGHT[entry.priority] },
    shop: { value: (entry) => entry.shopNamePrimary || entry.shopName },
    region: { value: (entry) => entry.region },
    am: { value: (entry) => entry.ownerAmName },
    lastVisit: { value: (entry) => entry.currentRow.visit_date, compare: compareDate },
    observation: { value: (entry) => OUTCOME_LABEL[entry.outcome] },
    lastScan: {
        value: (entry) => (entry.attributedRow ?? entry.currentRow).last_scan_after_at,
        compare: compareDate,
    },
    action: { value: (entry) => entry.action },
    due: { value: (entry) => entry.dueDate, compare: compareDate },
}

export const followUpTieBreak = (entry: ShopReportEntry) => `${entry.shopName}|${entry.shopId}`

/** The queue keeps its business order until the user selects a column. */
export function orderFollowUpQueue(
    entries: ShopReportEntry[],
    sort: SortState<FollowUpSortKey> | null,
): ShopReportEntry[] {
    if (!sort) return sortFollowUpQueue(entries)
    return applySort(entries, FOLLOW_UP_SORT_COLUMNS[sort.key], sort.direction, followUpTieBreak)
}
