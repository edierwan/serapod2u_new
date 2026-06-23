import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/warehouse/active-orders
 *
 * Orders that still REQUIRE warehouse receiving (for the Warehouse Receive
 * dropdown). An order is active when it is not started, partially received, or
 * otherwise still has remaining ordered quantity:
 *
 *     remaining = ordered_units - cumulative_received_units > 0
 *
 * Fully received orders are excluded so they cannot be received again. We do NOT
 * rely on QR status alone, because QR can be 'completed' while inventory is only
 * partially received (partial mode). "Cumulative received" comes from posted
 * receipt line items (the inventory source of truth), not from QR counts.
 *
 * Full-receive / legacy completed batches (receiving_status 'completed' and mode
 * not 'partial') are treated as fully received.
 */
export async function GET(_request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let companyId: string | null = null
  try {
    const { data } = await authClient.rpc('get_user_company_id')
    companyId = (data as string) || null
  } catch { /* fall through */ }

  const supabase = createAdminClient()

  let batchQuery = supabase
    .from('qr_batches')
    .select(`
      id, order_id, receiving_status, receiving_mode, created_at,
      orders!inner ( id, order_no, display_doc_no, created_at, status,
        buyer_org:organizations!orders_buyer_org_id_fkey(org_name) )
    `)
    .in('orders.status', ['approved', 'closed'])
    .order('created_at', { ascending: false })

  if (companyId) batchQuery = batchQuery.eq('company_id', companyId)

  const { data: batches, error } = await batchQuery
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Cumulative received per order from posted receipt items (partial path).
  const receivedByOrder = new Map<string, number>()
  try {
    let riQuery = supabase.from('warehouse_receipt_items').select('order_id, received_now')
    if (companyId) riQuery = riQuery.eq('company_id', companyId)
    const { data: items } = await riQuery
    for (const it of items || []) {
      receivedByOrder.set(it.order_id, (receivedByOrder.get(it.order_id) || 0) + (it.received_now || 0))
    }
  } catch { /* receipt tables may be absent; treat as 0 received */ }

  const seen = new Set<string>()
  const active: any[] = []

  for (const b of batches || []) {
    const order = (b as any).orders
    if (!order || seen.has(order.id)) continue

    // Legacy completed batch (full mode) with NO warehouse receipt records.
    // These batches were fully received before the decoupled partial-receiving
    // system existed, so treat them as fully received and exclude them.
    // If receipt records exist for this order, the inventory math below is
    // authoritative regardless of QR status — even if cumulative received is
    // zero (the order had a receipt attempt but zero units posted).
    if (b.receiving_status === 'completed' && b.receiving_mode !== 'partial' && !receivedByOrder.has(order.id)) {
      seen.add(order.id)
      continue
    }

    // In-flight QR -> always active.
    if (b.receiving_status === 'queued' || b.receiving_status === 'processing') {
      seen.add(order.id)
      active.push(toOrder(order))
      continue
    }

    // Otherwise use inventory receiving state: remaining > 0.
    const { count: orderedCount } = await supabase
      .from('qr_codes')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', b.id)
      .eq('is_buffer', false)

    const ordered = orderedCount || 0
    if (ordered === 0) continue // no codes yet -> nothing to receive

    const received = receivedByOrder.get(order.id) || 0
    if (ordered - received > 0) {
      seen.add(order.id)
      active.push(toOrder(order))
    } else {
      seen.add(order.id) // fully received
    }
  }

  return NextResponse.json({ orders: active })
}

function toOrder(order: any) {
  return {
    id: order.id,
    order_no: order.order_no,
    display_doc_no: order.display_doc_no,
    created_at: order.created_at,
    buyer_org: { org_name: order.buyer_org?.org_name || '' },
  }
}
