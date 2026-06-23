import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { markWarrantyBufferReceived } from '@/lib/warehouse/qrEligibility'

export const dynamic = 'force-dynamic'

/**
 * Resolve the warehouse org id for a buyer org (HQ -> first active WH child).
 * Mirrors the worker's resolveWarehouseOrgId so inventory lands on the same org.
 */
async function resolveWarehouseOrgId(supabase: any, buyerOrgId: string): Promise<string> {
  if (!buyerOrgId) return buyerOrgId
  const { data: buyerOrg } = await supabase
    .from('organizations')
    .select('org_type_code')
    .eq('id', buyerOrgId)
    .single()

  if (buyerOrg?.org_type_code === 'HQ') {
    const { data: whOrg } = await supabase
      .from('organizations')
      .select('id')
      .eq('parent_org_id', buyerOrgId)
      .eq('org_type_code', 'WH')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .single()
    if (whOrg) return whOrg.id
  }
  return buyerOrgId
}

/**
 * POST /api/warehouse/confirm-receipt
 *
 * Body:
 *   {
 *     order_id, batch_id,
 *     receipt_type: 'partial' | 'full',
 *     items?: [{ variant_id, product_id, received_now }],   // required for partial
 *     idempotency_key?: string,
 *     notes?: string
 *   }
 *
 * Partial:
 *   - On the FIRST receipt (QR not yet completed/processing), queue the QR worker
 *     in 'partial' mode so it transitions ALL QR/master codes once, regardless of
 *     the quantities entered. Subsequent receipts skip the worker.
 *   - Inventory is posted ONLY from the submitted received_now quantities via the
 *     idempotent post_warehouse_receipt RPC. No automatic warranty buffer.
 *
 * Full (Receive All):
 *   - Queue the QR worker in 'full' mode (preserves existing order+buffer posting).
 *   - Record an audit receipt header (best-effort) without re-posting inventory.
 */
export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { order_id, batch_id, receipt_type, items, idempotency_key, notes } = body

  if (!order_id || !batch_id) {
    return NextResponse.json({ error: 'order_id and batch_id are required' }, { status: 400 })
  }
  if (receipt_type !== 'partial' && receipt_type !== 'full') {
    return NextResponse.json({ error: "receipt_type must be 'partial' or 'full'" }, { status: 400 })
  }

  // Optional receipt remark (delivery condition / shortage / damage / note).
  // Trimmed and capped; stored on the receipt, separate from stock-movement notes.
  const cleanNotes = typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 500) : null

  const supabase = createAdminClient()

  // Load batch + order context
  const { data: batch, error: batchError } = await supabase
    .from('qr_batches')
    .select('id, company_id, order_id, receiving_status, receiving_mode, orders(buyer_org_id, seller_org_id, order_no)')
    .eq('id', batch_id)
    .single()

  if (batchError || !batch) {
    return NextResponse.json({ error: batchError?.message || 'Batch not found' }, { status: 404 })
  }

  const order = batch.orders as any
  const companyId = batch.company_id
  const warehouseOrgId = await resolveWarehouseOrgId(supabase, order?.buyer_org_id)
  const manufacturerOrgId = order?.seller_org_id || null

  const receivedByMeta = JSON.stringify({ received_by: user.id })
  const qrAlreadyDone = batch.receiving_status === 'completed'
  const qrInFlight = batch.receiving_status === 'queued' || batch.receiving_status === 'processing'

  // ----------------------------------------------------------------------
  // FULL RECEIVE
  // ----------------------------------------------------------------------
  if (receipt_type === 'full') {
    // Queue worker (full mode) unless QR is already done or running.
    if (!qrAlreadyDone && !qrInFlight) {
      const { error: queueError } = await supabase
        .from('qr_batches')
        .update({
          receiving_status: 'queued',
          receiving_mode: 'full',
          last_error: receivedByMeta,
          updated_at: new Date().toISOString(),
        })
        .eq('id', batch_id)
      if (queueError) {
        return NextResponse.json({ error: queueError.message }, { status: 500 })
      }
    }

    // Best-effort audit receipt (no inventory posting here — the worker posts).
    let auditReceiptNo: string | null = null
    try {
      const { data: existing } = await supabase
        .from('warehouse_receipts')
        .select('id, receipt_no')
        .eq('idempotency_key', idempotency_key || `full-${batch_id}`)
        .maybeSingle()

      if (existing) {
        auditReceiptNo = existing.receipt_no
      } else {
        const { data: seqData } = await supabase.rpc('next_warehouse_receipt_no', { p_batch_id: batch_id })
        auditReceiptNo = (seqData as string) || `WR-${order?.order_no || 'BATCH'}-01`
        await supabase.from('warehouse_receipts').insert({
          company_id: companyId,
          order_id,
          batch_id,
          receipt_no: auditReceiptNo,
          receipt_type: 'full',
          posting_status: 'posted',
          notes: cleanNotes || 'Receive All (Order + Buffer)',
          idempotency_key: idempotency_key || `full-${batch_id}`,
          received_by: user.id,
        })
      }
    } catch (e) {
      // Receipt tables not present yet — non-fatal for the full flow.
      console.warn('[confirm-receipt] full audit receipt skipped:', (e as any)?.message)
    }

    return NextResponse.json({
      success: true,
      mode: 'full',
      qr_worker_triggered: !qrAlreadyDone,
      receipt_no: auditReceiptNo,
    })
  }

  // ----------------------------------------------------------------------
  // PARTIAL RECEIVE
  // ----------------------------------------------------------------------
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items are required for a partial receipt' }, { status: 400 })
  }

  const cleanItems = items
    .map((i: any) => ({
      variant_id: i.variant_id,
      product_id: i.product_id || null,
      received_now: Math.max(0, parseInt(i.received_now, 10) || 0),
    }))
    .filter((i: any) => i.variant_id)

  const totalNow = cleanItems.reduce((s: number, i: any) => s + i.received_now, 0)
  if (totalNow <= 0) {
    return NextResponse.json({ error: 'Enter a quantity greater than zero on at least one product' }, { status: 400 })
  }

  // ORCHESTRATION (decoupled & retry-safe):
  // 1. Post inventory FIRST (durable receipt + stock movements, atomic & idempotent).
  //    If this fails we have NOT started any QR work, so the user can simply retry.
  //    This prevents the previous "QR completed but inventory failed silently" bug.
  const { data: postResult, error: postError } = await supabase.rpc('post_warehouse_receipt', {
    p_batch_id: batch_id,
    p_order_id: order_id,
    p_company_id: companyId,
    p_warehouse_org_id: warehouseOrgId,
    p_manufacturer_org_id: manufacturerOrgId,
    p_receipt_type: 'partial',
    p_received_by: user.id,
    p_items: cleanItems,
    p_idempotency_key: idempotency_key || null,
    p_notes: cleanNotes || undefined,
  })

  if (postError) {
    return NextResponse.json({
      error: postError.message,
      stage: 'inventory_posting',
      hint: 'Inventory was not posted and no QR processing was started. You can retry safely.',
    }, { status: 500 })
  }

  // 2. Inventory is posted. Now handle QR eligibility — never on page load, only here.
  let qrWorkerTriggered = false
  if (!qrAlreadyDone && !qrInFlight) {
    // First receipt: queue the QR worker ONCE in partial mode (QR-only).
    const { error: queueError } = await supabase
      .from('qr_batches')
      .update({
        receiving_status: 'queued',
        receiving_mode: 'partial',
        last_error: receivedByMeta,
        updated_at: new Date().toISOString(),
      })
      .eq('id', batch_id)
    if (queueError) {
      // Inventory already posted successfully; surface QR-queue failure separately.
      return NextResponse.json({
        success: true,
        mode: 'partial',
        qr_worker_triggered: false,
        qr_queue_error: queueError.message,
        receipt: postResult,
      })
    }
    qrWorkerTriggered = true
  } else if (qrAlreadyDone) {
    // QR already completed (e.g. recovered batch): do NOT re-run the worker.
    // Reconcile warranty-buffer eligibility (idempotent, QR status only) so buffer
    // codes that were missed by an earlier (pre-fix) run reach received_warehouse.
    let warrantyBonusPercent = 0
    if (manufacturerOrgId) {
      const { data: mfgOrg } = await supabase
        .from('organizations').select('warranty_bonus').eq('id', manufacturerOrgId).single()
      if ((mfgOrg as any)?.warranty_bonus) warrantyBonusPercent = Number((mfgOrg as any).warranty_bonus)
    }
    if (warrantyBonusPercent > 0) {
      const { data: oItems } = await supabase
        .from('order_items').select('variant_id').eq('order_id', order_id)
      const variantIds = (oItems || []).map((i: any) => i.variant_id).filter(Boolean)
      try {
        await markWarrantyBufferReceived(supabase, batch_id, variantIds, warrantyBonusPercent)
      } catch (e) {
        console.warn('[confirm-receipt] buffer eligibility reconciliation failed (non-fatal):', (e as any)?.message)
      }
    }
  } else if (batch.receiving_mode !== 'partial') {
    // Queued/processing without a mode tag — ensure it's marked partial.
    await supabase.from('qr_batches').update({ receiving_mode: 'partial' }).eq('id', batch_id)
  }

  return NextResponse.json({
    success: true,
    mode: 'partial',
    qr_worker_triggered: qrWorkerTriggered,
    qr_already_completed: qrAlreadyDone,
    receipt: postResult,
  })
}
