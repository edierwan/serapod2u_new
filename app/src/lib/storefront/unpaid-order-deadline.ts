/** An Outdoor order still unpaid this long after it was placed is cancelled. */
export const UNPAID_ORDER_TTL_HOURS = 24
const TTL_MS = UNPAID_ORDER_TTL_HOURS * 60 * 60 * 1000

/** Only these channels expire unpaid orders; the classic store keeps its own flow. */
export const EXPIRING_CHANNELS = ['outdoor']

export function unpaidOrderCutoff(now: Date = new Date()) {
  return new Date(now.getTime() - TTL_MS).toISOString()
}

export function unpaidOrderDeadline(createdAt: string | null | undefined): Date | null {
  const placed = createdAt ? new Date(createdAt).getTime() : NaN
  return Number.isFinite(placed) ? new Date(placed + TTL_MS) : null
}

export function isUnpaidOrderExpired(
  order: { status?: string | null; created_at?: string | null; sales_channel?: string | null },
  now: Date = new Date(),
) {
  if (order.status !== 'pending_payment') return false
  if (!EXPIRING_CHANNELS.includes(String(order.sales_channel || 'store'))) return false
  const deadline = unpaidOrderDeadline(order.created_at)
  return deadline !== null && deadline.getTime() <= now.getTime()
}
