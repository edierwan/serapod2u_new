/**
 * Movement Reports — the Reference shown for a stock movement.
 *
 * stock_movements.reference_no is a snapshot written when the movement was
 * posted. For order movements that is orders.order_no — the legacy internal
 * number (e.g. ORD-HM-0926-25) — while Serapod2U presents orders by
 * orders.display_doc_no (ORD26000093). The movement already carries the order
 * UUID in reference_id, so the report resolves the order through that relation
 * at display time. Historical movements are never rewritten.
 *
 *   order-linked movement + order found → display_doc_no || order_no
 *   anything else (no link, order gone)  → the stored reference_no, unchanged
 */

/** reference_type values whose reference_id is an orders.id. */
export const ORDER_REFERENCE_TYPES = ['order', 'order_config_change', 'order_cancel_reversal'] as const

export interface MovementReferenceFields {
  movement_type?: string | null
  reference_type?: string | null
  reference_id?: string | null
  reference_no?: string | null
}

export interface OrderNumberFields {
  id: string
  order_no?: string | null
  display_doc_no?: string | null
}

/** The order number Serapod2U presents: display_doc_no, else the internal order_no. */
export function canonicalOrderNumber(order: OrderNumberFields | null | undefined): string | null {
  if (!order) return null
  return (order.display_doc_no || '').trim() || (order.order_no || '').trim() || null
}

/** True when the movement's reference_id points at an order. */
export function isOrderLinkedMovement(movement: MovementReferenceFields): boolean {
  if (!movement.reference_id) return false
  return (ORDER_REFERENCE_TYPES as readonly string[]).includes(movement.reference_type || '')
    || movement.movement_type === 'order_fulfillment'
}

/** Order ids to look up for a page of movements. */
export function orderIdsForMovements(movements: MovementReferenceFields[]): string[] {
  return Array.from(new Set(movements.filter(isOrderLinkedMovement).map((m) => m.reference_id as string)))
}

export function resolveMovementReferenceNo(
  movement: MovementReferenceFields,
  ordersById: Map<string, OrderNumberFields>,
): string | null {
  if (isOrderLinkedMovement(movement)) {
    const resolved = canonicalOrderNumber(ordersById.get(movement.reference_id as string))
    if (resolved) return resolved
  }
  return movement.reference_no ?? null
}
