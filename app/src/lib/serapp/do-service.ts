import type { SupabaseClient } from '@supabase/supabase-js'

export interface SerappDeliveryOrderDoc {
  id: string
  order_id: string
  doc_no: string
  display_doc_no: string | null
  status: string
  created_at?: string | null
}

/**
 * Ensure a Delivery Order document exists for a Serapp-accepted D2H order.
 *
 * Mirrors the DO row shape from `orders_approve`, but:
 * - does NOT approve the order
 * - does NOT fulfill inventory
 * - does NOT create SO / Invoice
 *
 * Safe for warehouse accept (WH may lack HQ `orders_approve` authority).
 * Idempotent: returns existing DO if one already exists for the order.
 */
export async function ensureSerappDeliveryOrder(
  admin: SupabaseClient<any>,
  input: { orderId: string; createdBy: string },
): Promise<{
  doc: SerappDeliveryOrderDoc | null
  created: boolean
  skippedReason?: string
}> {
  const { data: existing } = await admin
    .from('documents')
    .select('id, order_id, doc_no, display_doc_no, status, created_at')
    .eq('order_id', input.orderId)
    .eq('doc_type', 'DO')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    return { doc: existing as SerappDeliveryOrderDoc, created: false }
  }

  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, company_id, order_no, order_type, status, seller_org_id, buyer_org_id')
    .eq('id', input.orderId)
    .maybeSingle()

  if (orderError) throw orderError
  if (!order) {
    return { doc: null, created: false, skippedReason: 'order_not_found' }
  }

  if (order.order_type !== 'D2H') {
    return { doc: null, created: false, skippedReason: 'not_d2h' }
  }

  // Serapp confirm leaves order as submitted; cancel/expire must not get a DO.
  if (order.status !== 'submitted' && order.status !== 'approved') {
    return { doc: null, created: false, skippedReason: `order_status_${order.status}` }
  }

  if (!order.company_id || !order.seller_org_id || !order.buyer_org_id || !order.order_no) {
    return { doc: null, created: false, skippedReason: 'order_incomplete' }
  }

  const docNo = `DO-${order.order_no}`
  const { data: inserted, error: insertError } = await admin
    .from('documents')
    .insert({
      company_id: order.company_id,
      order_id: order.id,
      doc_type: 'DO',
      doc_no: docNo,
      status: 'pending',
      issued_by_org_id: order.seller_org_id,
      issued_to_org_id: order.buyer_org_id,
      created_by: input.createdBy,
    })
    .select('id, order_id, doc_no, display_doc_no, status, created_at')
    .maybeSingle()

  if (insertError) {
    // Race: another accept/approve may have created the DO concurrently.
    const { data: raced } = await admin
      .from('documents')
      .select('id, order_id, doc_no, display_doc_no, status, created_at')
      .eq('order_id', input.orderId)
      .eq('doc_type', 'DO')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (raced) {
      return { doc: raced as SerappDeliveryOrderDoc, created: false }
    }
    throw insertError
  }

  if (!inserted) {
    return { doc: null, created: false, skippedReason: 'insert_returned_null' }
  }

  return { doc: inserted as SerappDeliveryOrderDoc, created: true }
}

export function serappDoDownloadUrl(orderId: string, documentId: string): string {
  return `/api/documents/generate?orderId=${encodeURIComponent(orderId)}&type=delivery_order&documentId=${encodeURIComponent(documentId)}`
}
