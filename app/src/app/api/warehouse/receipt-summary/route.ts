import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const STALE_THRESHOLD_MS = 3 * 60 * 1000 // 3 minutes

/**
 * GET /api/warehouse/receipt-summary?order_id=...
 *
 * Returns everything the Warehouse Receive screen needs to render the order:
 *  - ordered qty / expected buffer / expected total
 *  - inventory received to date / remaining ordered / actual extra received
 *  - per-product rows (ordered, previously received, cumulative, balance, extra)
 *  - live worker / batch progress (master + unique codes, status, stale flag)
 *
 * "Received to date" is sourced from posted warehouse_receipt_items (the
 * decoupled inventory source of truth), NOT from the number of received QR
 * codes. If the receipt tables are not present yet (migrations not applied),
 * the endpoint degrades gracefully to zero received.
 */
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('order_id')
  if (!orderId) {
    return NextResponse.json({ error: 'order_id is required' }, { status: 400 })
  }

  // Auth gate (user-scoped client) then read with admin client for counts.
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  // 1. Order
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, order_no, display_doc_no, seller_org_id, buyer_org_id')
    .eq('id', orderId)
    .single()

  if (orderError || !order) {
    return NextResponse.json({ error: orderError?.message || 'Order not found' }, { status: 404 })
  }

  // 2. Primary batch for the order.
  //    receiving_mode may not exist before migrations are applied; fall back to a
  //    select without it so the screen still renders against an un-migrated DB.
  let batch: any = null
  {
    const withMode = await supabase
      .from('qr_batches')
      .select('id, receiving_status, receiving_mode, receiving_heartbeat, receiving_worker_id, receiving_progress, receiving_completed_at, total_master_codes, total_unique_codes')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true })
      .limit(1)
      .single()
    if (!withMode.error) {
      batch = withMode.data
    } else {
      const legacy = await supabase
        .from('qr_batches')
        .select('id, receiving_status, receiving_heartbeat, receiving_worker_id, receiving_progress, receiving_completed_at, total_master_codes, total_unique_codes')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()
      batch = legacy.data
    }
  }

  if (!batch) {
    return NextResponse.json({ error: 'No batch found for order' }, { status: 404 })
  }

  // 3. Warranty bonus % from manufacturer (seller) org
  let warrantyBonusPercent = 0
  if (order.seller_org_id) {
    const { data: sellerOrg } = await supabase
      .from('organizations')
      .select('warranty_bonus')
      .eq('id', order.seller_org_id)
      .single()
    if ((sellerOrg as any)?.warranty_bonus) warrantyBonusPercent = Number((sellerOrg as any).warranty_bonus)
  }

  // 4. Order line items (product + variant names)
  const { data: orderItems } = await supabase
    .from('order_items')
    .select('product_id, variant_id, unit_price, products(product_name), product_variants(variant_name)')
    .eq('order_id', orderId)

  const variantIds = Array.from(new Set((orderItems || []).map((item: any) => item.variant_id).filter(Boolean)))
  const { data: destinationConfigs } = variantIds.length
    ? await supabase.from('inventory_stock_configurations')
      .select('id, variant_id, config_label, stock_sku, volume_ml, packaging, default_for_ord, allow_ord, status, is_variant_default')
      .in('variant_id', variantIds)
      .order('sort_order')
    : { data: [] }
  const destinationByVariant = new Map<string, any>()
  for (const config of destinationConfigs || []) {
    const current = destinationByVariant.get(config.variant_id)
    const isOrdDestination = config.default_for_ord && config.allow_ord && config.status === 'active'
    if (!current || isOrdDestination || (!current.default_for_ord && config.is_variant_default)) {
      destinationByVariant.set(config.variant_id, config)
    }
  }

  // 5. Previously received per variant (decoupled inventory source of truth).
  //    Degrade gracefully if the receipt tables don't exist yet.
  const receivedByVariant = new Map<string, number>()
  let receiptTablesAvailable = true
  try {
    const { data: receiptItems, error: riError } = await supabase
      .from('warehouse_receipt_items')
      .select('variant_id, received_now')
      .eq('order_id', orderId)
    if (riError) {
      receiptTablesAvailable = false
    } else {
      for (const ri of receiptItems || []) {
        if (ri.variant_id) {
          receivedByVariant.set(ri.variant_id, (receivedByVariant.get(ri.variant_id) || 0) + (ri.received_now || 0))
        }
      }
    }
  } catch {
    receiptTablesAvailable = false
  }

  // 6. Per-variant ordered (non-buffer QR codes), build rows.
  const items: any[] = []
  let orderedTotal = 0
  let receivedTotal = 0
  let extraTotal = 0

  for (const oi of orderItems || []) {
    const variantId = oi.variant_id
    if (!variantId) continue

    const { count: orderedCount } = await supabase
      .from('qr_codes')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batch.id)
      .eq('variant_id', variantId)
      .eq('is_buffer', false)

    const ordered = orderedCount || 0
    const previously = receivedByVariant.get(variantId) || 0
    const balance = Math.max(0, ordered - previously)
    const extra = Math.max(0, previously - ordered)

    orderedTotal += ordered
    receivedTotal += previously
    extraTotal += extra

    items.push({
      product_id: oi.product_id,
      variant_id: variantId,
      product_name: (oi.products as any)?.product_name || 'Product',
      variant_name: (oi.product_variants as any)?.variant_name || '',
      ordered_qty: ordered,
      previously_received: previously,
      cumulative_received: previously,
      ordered_balance: balance,
      extra_received: extra,
      destination_stock_config: destinationByVariant.get(variantId) || null,
    })
  }

  // 7. Live batch / worker progress
  const [{ count: masterTotal }, { count: masterDone }, { count: uniqueDone }, { count: bufferReceived }] = await Promise.all([
    supabase.from('qr_master_codes').select('*', { count: 'exact', head: true }).eq('batch_id', batch.id),
    supabase.from('qr_master_codes').select('*', { count: 'exact', head: true }).eq('batch_id', batch.id).eq('status', 'received_warehouse'),
    supabase.from('qr_codes').select('*', { count: 'exact', head: true }).eq('batch_id', batch.id).eq('is_buffer', false).eq('status', 'received_warehouse'),
    supabase.from('qr_codes').select('*', { count: 'exact', head: true }).eq('batch_id', batch.id).eq('is_buffer', true).eq('status', 'received_warehouse'),
  ])

  // Unique-codes progress is the ORDERED (non-buffer) total, never including the
  // buffer codes (batch.total_unique_codes can include buffer, e.g. 3,300).
  const totalUnique = orderedTotal || batch.total_unique_codes || 0

  // Expected warranty buffer is computed from the ACTUAL configured manufacturer
  // warranty percentage (organizations.warranty_bonus), not from the raw number
  // of generated buffer QR codes (which may have been over-provisioned at a
  // different batch.buffer_percent). Never hardcoded.
  const expectedBuffer = Math.floor(orderedTotal * (warrantyBonusPercent / 100))

  // Stale detection (mirror existing UI logic)
  let isStale = false
  if (batch.receiving_status === 'processing') {
    if (batch.receiving_heartbeat) {
      isStale = (Date.now() - new Date(batch.receiving_heartbeat).getTime()) > STALE_THRESHOLD_MS
    } else {
      isStale = true
    }
  }

  const qrCompleted = batch.receiving_status === 'completed'

  // Receipt status
  let receiptStatus: 'not_started' | 'partially_received' | 'fully_received' = 'not_started'
  if (receivedTotal > 0 && receivedTotal < orderedTotal) receiptStatus = 'partially_received'
  else if (receivedTotal >= orderedTotal && orderedTotal > 0) receiptStatus = 'fully_received'

  return NextResponse.json({
    order: {
      id: order.id,
      order_no: order.order_no,
      display_doc_no: order.display_doc_no,
    },
    batch: {
      id: batch.id,
      batch_code: `BATCH-${order.order_no}`,
      receiving_status: batch.receiving_status || 'idle',
      receiving_mode: batch.receiving_mode ?? null,
      receiving_worker_id: batch.receiving_worker_id,
      receiving_heartbeat: batch.receiving_heartbeat,
      receiving_progress: batch.receiving_progress,
      receiving_completed_at: batch.receiving_completed_at,
      qr_completed: qrCompleted,
      is_stale: isStale,
      total_master_codes: masterTotal || 0,
      received_master_codes: masterDone || 0,
      total_unique_codes: totalUnique,
      received_unique_codes: uniqueDone || 0,
      buffer_codes: expectedBuffer,
      received_buffer_codes: bufferReceived || 0,
    },
    summary: {
      ordered_qty: orderedTotal,
      expected_buffer: expectedBuffer,
      expected_total: orderedTotal + expectedBuffer,
      inventory_received: receivedTotal,
      remaining_ordered: Math.max(0, orderedTotal - receivedTotal),
      actual_extra_received: extraTotal,
      receipt_status: receiptStatus,
    },
    items,
    warranty_bonus_percent: warrantyBonusPercent,
    receipt_tables_available: receiptTablesAvailable,
  })
}
