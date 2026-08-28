/**
 * Ordering for the Orders list table.
 *
 * `sortedOrders` runs at the top of OrdersView's render, but the helpers it
 * called — `calculateOrderTotal` in particular — were declared as `const`
 * arrow functions several hundred lines further down the same component body.
 * Both run in the same render pass, so clicking the Total or Balance column
 * header hit the temporal dead zone and threw a ReferenceError. Hoisting them
 * out to module scope removes the hazard entirely instead of relying on the
 * declaration order inside the component.
 *
 * The arithmetic and the comparison rules are a faithful copy of what the
 * component did before: same reduce, same `|| 0` fallbacks, same
 * approved-means-zero balance rule, same `<` / `>` comparator.
 */

import { getOrderDisplayOrgName, type SearchableOrder } from './order-search'

export type OrderSortDirection = 'asc' | 'desc'

export interface SortableOrderItem {
  line_total?: number | null
}

export interface SortableOrder extends SearchableOrder {
  created_at?: string | null
  status?: string | null
  created_by_user?: { full_name?: string | null; email?: string | null } | null
  order_items?: SortableOrderItem[] | null
}

/** Sum of the order's line totals. Unchanged: `reduce` with `|| 0` fallbacks. */
export function calculateOrderTotal(order: SortableOrder): number {
  return order.order_items?.reduce((sum, item) => sum + (item.line_total || 0), 0) || 0
}

/** Outstanding balance: an approved order is settled, anything else is its total. */
export function calculateOrderBalance(order: SortableOrder): number {
  return order.status === 'approved' ? 0 : calculateOrderTotal(order)
}

/** The value a given column sorts on, or null for an unknown column. */
function sortValue(
  order: SortableOrder,
  sortColumn: string,
  viewerOrgId?: string | null,
): string | number | null {
  switch (sortColumn) {
    case 'created_at':
      return new Date(order.created_at as string).getTime()
    case 'order_no':
      return order.order_no as string
    case 'seller':
      return getOrderDisplayOrgName(order, viewerOrgId)
    case 'total':
      return calculateOrderTotal(order)
    case 'balance':
      return calculateOrderBalance(order)
    case 'status':
      return order.status as string
    case 'created_by':
      return order.created_by_user?.full_name || order.created_by_user?.email || ''
    default:
      return null
  }
}

/** Comparator for the Orders table. An unknown column leaves the order as-is. */
export function compareOrders(
  a: SortableOrder,
  b: SortableOrder,
  sortColumn: string,
  sortDirection: OrderSortDirection,
  viewerOrgId?: string | null,
): number {
  const aValue = sortValue(a, sortColumn, viewerOrgId)
  const bValue = sortValue(b, sortColumn, viewerOrgId)
  if (aValue === null || bValue === null) return 0

  if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
  if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
  return 0
}

/** Non-mutating sort of the filtered orders. */
export function sortOrders<T extends SortableOrder>(
  orders: T[],
  sortColumn: string,
  sortDirection: OrderSortDirection,
  viewerOrgId?: string | null,
): T[] {
  return [...orders].sort((a, b) => compareOrders(a, b, sortColumn, sortDirection, viewerOrgId))
}
