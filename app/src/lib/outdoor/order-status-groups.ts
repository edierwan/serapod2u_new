export type OrderStatusGroup = 'all' | 'to_pay' | 'to_ship' | 'shipped' | 'delivered' | 'closed'

export const ORDER_STATUS_GROUPS: { key: OrderStatusGroup; label: string; statuses: string[] }[] = [
  { key: 'all', label: 'All', statuses: [] },
  { key: 'to_pay', label: 'To pay', statuses: ['pending_payment'] },
  { key: 'to_ship', label: 'Paid', statuses: ['paid', 'processing'] },
  { key: 'shipped', label: 'Shipped', statuses: ['shipped'] },
  { key: 'delivered', label: 'Delivered', statuses: ['delivered'] },
  { key: 'closed', label: 'Cancelled', statuses: ['cancelled', 'payment_failed', 'refunded'] },
]

export function orderInGroup(status: string, group: OrderStatusGroup) {
  if (group === 'all') return true
  return ORDER_STATUS_GROUPS.find((g) => g.key === group)?.statuses.includes(status) ?? false
}

export function groupOfStatus(status: string): OrderStatusGroup {
  return ORDER_STATUS_GROUPS.find((g) => g.key !== 'all' && g.statuses.includes(status))?.key ?? 'all'
}

/** Opens on what the customer most likely wants: an order on its way, then one to pay. */
export function defaultOrderGroup(statuses: string[]): OrderStatusGroup {
  for (const group of ['to_ship', 'shipped', 'to_pay'] as const) {
    if (statuses.some((status) => orderInGroup(status, group))) return group
  }
  return 'all'
}

export function orderStatusLabel(status: string) {
  if (status === 'pending_payment') return 'waiting for payment'
  if (status === 'payment_failed') return 'payment failed'
  return status.replace(/_/g, ' ')
}
