/**
 * "Count Type History" filtering.
 *
 * The Stock Count screen keeps one saved-session list that mixes every count
 * type (and legacy Initial-Classification history). The history panel must show
 * only the sessions belonging to the currently selected Count Type, mapping the
 * legacy database value `initial_configuration_classification` onto the same
 * displayed bucket as `opening_balance_cutoff` ("Inventory Opening Balance &
 * Initial Classification") so legacy labels are never mixed with other types.
 *
 * Pure module so the mapping + filtering can be unit tested without the DB.
 */

/** The four Count Types a user can select in the form / see history for. */
export type StockCountTypeBucket =
  | 'full_count'
  | 'cycle_count'
  | 'spot_check'
  | 'opening_balance_cutoff'

export const STOCK_COUNT_TYPE_BUCKET_LABELS: Record<StockCountTypeBucket, string> = {
  full_count: 'Full Physical Count',
  cycle_count: 'Partial / Cycle Count',
  spot_check: 'Spot Check',
  opening_balance_cutoff: 'Inventory Opening Balance & Initial Classification',
}

/**
 * Map a stored `count_type` (one of the five DB-constrained values) onto its
 * displayed history bucket. The legacy `initial_configuration_classification`
 * value is folded into the Opening Balance & Initial Classification bucket.
 */
export function resolveStockCountTypeBucket(countType: string | null | undefined): StockCountTypeBucket {
  switch (countType) {
    case 'cycle_count':
      return 'cycle_count'
    case 'spot_check':
      return 'spot_check'
    case 'opening_balance_cutoff':
    case 'initial_configuration_classification':
      return 'opening_balance_cutoff'
    case 'full_count':
    default:
      return 'full_count'
  }
}

/** Human label for the bucket of the given selected count type. */
export function stockCountTypeBucketLabel(countType: string | null | undefined): string {
  return STOCK_COUNT_TYPE_BUCKET_LABELS[resolveStockCountTypeBucket(countType)]
}

/**
 * Keep only the sessions whose bucket matches the selected count type. Purely a
 * display filter — it never mutates the underlying list or the active count.
 */
export function filterSessionsByCountType<T extends { count_type: string | null | undefined }>(
  sessions: T[],
  selectedCountType: string | null | undefined,
): T[] {
  const target = resolveStockCountTypeBucket(selectedCountType)
  return sessions.filter(session => resolveStockCountTypeBucket(session.count_type) === target)
}

/** Empty-state text, e.g. "No Spot Check history found." */
export function stockCountHistoryEmptyMessage(selectedCountType: string | null | undefined): string {
  return `No ${stockCountTypeBucketLabel(selectedCountType)} history found.`
}
