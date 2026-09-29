export type OrderEventType = 'created' | 'status_changed' | 'shipping_updated' | 'note'
export type OrderEventActor = 'customer' | 'staff' | 'payment' | 'system'

export interface OrderEventInput {
  orderId: string
  eventType: OrderEventType
  actorType: OrderEventActor
  fromStatus?: string | null
  toStatus?: string | null
  actorId?: string | null
  actorLabel?: string | null
  note?: string | null
}

export function orderEventRow(input: OrderEventInput) {
  return {
    order_id: input.orderId,
    event_type: input.eventType,
    actor_type: input.actorType,
    from_status: input.fromStatus && input.fromStatus !== input.toStatus ? input.fromStatus : null,
    to_status: input.toStatus || null,
    actor_id: input.actorId || null,
    actor_label: input.actorLabel ? String(input.actorLabel).slice(0, 160) : null,
    note: input.note ? String(input.note).slice(0, 500) : null,
  }
}

/**
 * Appends one line to the order history. Never throws: the history must not be able
 * to fail the order action it describes (or break before its migration is applied).
 */
export async function recordOrderEvent(admin: any, input: OrderEventInput) {
  try {
    const { error } = await admin.from('storefront_order_events').insert(orderEventRow(input))
    if (error) console.warn('[order-events] not recorded:', error.message || error)
  } catch (err) {
    console.warn('[order-events] not recorded:', err instanceof Error ? err.message : err)
  }
}

/** Name shown in the history for a staff member. */
export async function staffActorLabel(admin: any, userId: string) {
  try {
    const { data } = await admin.from('users').select('full_name, email').eq('id', userId).maybeSingle()
    return String(data?.full_name || data?.email || '').trim() || 'Staff'
  } catch {
    return 'Staff'
  }
}
