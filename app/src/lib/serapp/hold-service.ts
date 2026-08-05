import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildSerappHoldNotes,
  computeSerappHoldExpiry,
  shouldExpireSerappHold,
  type SerappHoldStatus,
} from '@/lib/serapp/holds'

export interface SerappHoldRow {
  id: string
  order_id: string
  buyer_org_id: string
  seller_hq_id: string
  fulfillment_warehouse_id: string
  status: SerappHoldStatus
  expires_at: string
  reserved_at: string
}

export async function registerSerappOrderHold(
  supabase: SupabaseClient<any>,
  input: {
    orderId: string
    buyerOrgId: string
    sellerHqId: string
    fulfillmentWarehouseId: string
    createdBy: string
    orderNo?: string | null
    warehouseName?: string | null
  },
) {
  const expiresAt = computeSerappHoldExpiry()
  const { data, error } = await supabase
    .from('serapp_order_holds')
    .upsert({
      order_id: input.orderId,
      buyer_org_id: input.buyerOrgId,
      seller_hq_id: input.sellerHqId,
      fulfillment_warehouse_id: input.fulfillmentWarehouseId,
      created_by: input.createdBy,
      status: 'active',
      reserved_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      notes: buildSerappHoldNotes({
        orderNo: input.orderNo,
        warehouseName: input.warehouseName,
      }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'order_id' })
    .select('id, order_id, buyer_org_id, seller_hq_id, fulfillment_warehouse_id, status, expires_at, reserved_at')
    .single()

  if (error) throw error
  return data as SerappHoldRow
}

/**
 * Expire one hold: mark hold expired, cancel submitted order, release allocation.
 * Idempotent if hold is no longer active.
 */
export async function expireSerappOrderHold(
  admin: SupabaseClient<any>,
  hold: { id: string; order_id: string; status: string; expires_at: string },
  now = new Date(),
) {
  if (!shouldExpireSerappHold(hold, now)) {
    return { expired: false, reason: 'not_due_or_not_active' as const }
  }

  const { data: lockedHold, error: lockError } = await admin
    .from('serapp_order_holds')
    .update({
      status: 'expired',
      expired_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', hold.id)
    .eq('status', 'active')
    .select('id, order_id')
    .maybeSingle()

  if (lockError) throw lockError
  if (!lockedHold) {
    return { expired: false, reason: 'already_handled' as const }
  }

  const { data: order } = await admin
    .from('orders')
    .select('id, status, order_no')
    .eq('id', hold.order_id)
    .maybeSingle()

  if (order && order.status === 'submitted') {
    const { error: cancelError } = await admin
      .from('orders')
      .update({
        status: 'cancelled',
        updated_at: now.toISOString(),
        notes: `${order.order_no || hold.order_id}: Serapp hold expired after 1 hour without warehouse acceptance.`,
      })
      .eq('id', hold.order_id)
      .eq('status', 'submitted')

    if (cancelError) {
      // Best-effort explicit release if status update path fails partway.
      console.error('[serapp-hold] cancel update failed', cancelError)
    }

    const { error: releaseError } = await admin.rpc('release_allocation_for_order', {
      p_order_id: hold.order_id,
    })
    if (releaseError) {
      // Cancellation trigger may already have released; log but do not fail the batch hard.
      console.warn('[serapp-hold] release_allocation_for_order:', releaseError.message)
    }
  }

  return { expired: true, reason: 'expired' as const, orderId: hold.order_id }
}

export async function acceptSerappOrderHold(
  supabase: SupabaseClient<any>,
  input: { orderId: string; acceptedBy: string },
) {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('serapp_order_holds')
    .update({
      status: 'accepted',
      accepted_at: now,
      accepted_by: input.acceptedBy,
      updated_at: now,
    })
    .eq('order_id', input.orderId)
    .eq('status', 'active')
    .select('id, order_id, status, expires_at, accepted_at')
    .maybeSingle()

  if (error) throw error
  if (!data) {
    throw Object.assign(new Error('No active Serapp hold found for this order (it may have expired or already been accepted).'), {
      status: 409,
    })
  }
  return data
}

export async function cancelSerappOrderHoldByDistributor(
  supabase: SupabaseClient<any>,
  input: { orderId: string; cancelledBy: string },
) {
  const now = new Date()
  const { data: hold, error: holdError } = await supabase
    .from('serapp_order_holds')
    .update({
      status: 'cancelled_by_distributor',
      cancelled_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('order_id', input.orderId)
    .eq('status', 'active')
    .select('id, order_id')
    .maybeSingle()

  if (holdError) throw holdError
  if (!hold) {
    throw Object.assign(new Error('No active Serapp hold to cancel.'), { status: 409 })
  }

  const { error: cancelError } = await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      updated_at: now.toISOString(),
      updated_by: input.cancelledBy,
    })
    .eq('id', input.orderId)
    .eq('status', 'submitted')

  if (cancelError) throw cancelError

  const { error: releaseError } = await supabase.rpc('release_allocation_for_order', {
    p_order_id: input.orderId,
  })
  if (releaseError) {
    console.warn('[serapp-hold] distributor cancel release:', releaseError.message)
  }

  return hold
}
