/**
 * Supabase query helpers for business-date (`orders.order_date`) reporting,
 * shared by the monthly report sources and their exports.
 *
 * Every helper also works against a database that predates the order_date
 * migration: the same half-open business-date range is then applied to
 * `created_at` as Malaysia midnights, which is exactly how the migration
 * backfills legacy rows.
 */
import { ORDER_DATE_MIGRATION, businessDateStartUtc, isMissingOrderDateColumn } from '@/lib/orders/order-date'

/** The column business-date reads filter on: order_date, or created_at before the migration. */
export type OrderDateColumn = 'order_date' | 'created_at'

/**
 * Whether this database has `orders.order_date` yet. One cheap probe per
 * request, so application code deployed ahead of the manual migration degrades
 * to the legacy created_at semantics instead of failing with a column error.
 */
export async function resolveOrderDateColumn(supabase: any): Promise<OrderDateColumn> {
  const { error } = await supabase.from('orders').select('order_date').limit(1)
  if (!error) return 'order_date'
  if (isMissingOrderDateColumn(error)) return 'created_at'
  throw error
}

/** The date columns to select for a business-date read. */
export function orderDateSelect(column: OrderDateColumn): string {
  return column === 'order_date' ? 'order_date, created_at' : 'created_at'
}

/**
 * Restrict a query to the half-open business-date range [start, end).
 * `prefix` targets an embedded relation, e.g. `orders.` for an order_items join.
 * On a legacy database the same range is applied to created_at as MYT midnights.
 */
export function filterBusinessDateRange(query: any, column: OrderDateColumn, start: string, end: string, prefix = '') {
  return column === 'order_date'
    ? query.gte(`${prefix}order_date`, start).lt(`${prefix}order_date`, end)
    : query.gte(`${prefix}created_at`, businessDateStartUtc(start)).lt(`${prefix}created_at`, businessDateStartUtc(end))
}

/**
 * Deterministic business-date ordering. order_date is shared by many orders,
 * so paging on it alone could skip or repeat rows between pages; created_at and
 * id make every page boundary stable.
 */
export function orderByBusinessDate(query: any, column: OrderDateColumn, ascending: boolean) {
  const ordered = column === 'order_date' ? query.order('order_date', { ascending }) : query
  return ordered.order('created_at', { ascending }).order('id', { ascending })
}

/** The notice a report carries while it runs on the legacy created_at dates. */
export function legacyOrderDateNotice(column: OrderDateColumn): string | null {
  return column === 'order_date'
    ? null
    : `orders.order_date is not available yet — dates fall back to the Malaysia date of created_at. Apply migration ${ORDER_DATE_MIGRATION}.`
}
