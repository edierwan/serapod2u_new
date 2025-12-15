import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes max

// Configuration
const CHUNK_SIZE = 5000 // Process 5k codes per chunk
const STALE_THRESHOLD_MS = 3 * 60 * 1000 // 3 minutes - if no heartbeat, consider stale

// Generate short unique ID without uuid dependency
function generateWorkerId(): string {
  return Math.random().toString(36).substring(2, 10)
}

/**
 * Warehouse Receiving Worker
 * 
 * This worker processes QR code status updates in chunks with:
 * - Heartbeat tracking for stale detection
 * - Resumable processing (continues from where it left off)
 * - Proper cancellation support
 * - Progress tracking
 */
export async function GET(request: NextRequest) {
  const workerId = generateWorkerId()
  const startTime = Date.now()
  const supabase = createAdminClient()

  console.log(`🚀 [${workerId}] Warehouse Receiving Worker started`)

  try {
    // Step 1: Find and claim a batch to process
    const batch = await claimBatch(supabase, workerId)
    
    if (!batch) {
      console.log(`📭 [${workerId}] No batches to process`)
      return NextResponse.json({ message: 'No batches to process', worker_id: workerId })
    }

    console.log(`📦 [${workerId}] Claimed batch ${batch.id} (Order: ${batch.orders?.order_no})`)

    const order = batch.orders as any
    const warehouseOrgId = await resolveWarehouseOrgId(supabase, order?.buyer_org_id)
    const manufacturerOrgId = order?.seller_org_id
    const companyId = order?.company_id
    const orderId = order?.id
    const orderNo = order?.order_no

    // Get received_by from metadata
    let receivedBy = batch.created_by
    try {
      if (batch.last_error && batch.last_error.includes('received_by')) {
        const meta = JSON.parse(batch.last_error)
        if (meta.received_by) receivedBy = meta.received_by
      }
    } catch (e) { /* ignore */ }

    // Get variant price map for inventory
    const variantPriceMap = new Map<string, number>()
    if (order?.order_items) {
      order.order_items.forEach((item: any) => {
        if (item.variant_id && item.unit_price != null) {
          variantPriceMap.set(item.variant_id, Number(item.unit_price))
        }
      })
    }

    // Get warranty bonus
    let warrantyBonusPercent = 0
    if (manufacturerOrgId) {
      const { data: mfgOrg } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', manufacturerOrgId)
        .single()
      if ((mfgOrg as any)?.warranty_bonus) warrantyBonusPercent = Number((mfgOrg as any).warranty_bonus)
    }

    let totalProcessed = batch.receiving_progress || 0

    // Step 2: Process Master Codes (if not done)
    const masterResult = await processMasterCodes(supabase, batch.id, warehouseOrgId, manufacturerOrgId, companyId, orderId, receivedBy)
    console.log(`📦 [${workerId}] Master codes: ${masterResult.processed} processed`)

    // Step 3: Process Unique Codes in chunks
    console.log(`🔄 [${workerId}] Starting unique code processing. Current progress: ${totalProcessed}`)

    const cumulativeVariantCounts = new Map<string, number>()
    let chunksProcessed = 0
    let hasMore = true

    while (hasMore) {
      // Check for cancellation
      const { data: statusCheck } = await supabase
        .from('qr_batches')
        .select('receiving_status')
        .eq('id', batch.id)
        .single()

      if (statusCheck?.receiving_status === 'cancelled') {
        console.log(`🛑 [${workerId}] Job cancelled, stopping`)
        return NextResponse.json({ 
          message: 'Job cancelled', 
          worker_id: workerId,
          processed: totalProcessed 
        })
      }

      // Check time limit (leave 30s buffer)
      const elapsed = Date.now() - startTime
      if (elapsed > 270000) {
        console.log(`⏱️ [${workerId}] Time limit approaching, yielding. Processed: ${totalProcessed}`)
        await updateHeartbeat(supabase, batch.id, workerId, totalProcessed)
        return NextResponse.json({ 
          message: 'Partial processing, will continue',
          worker_id: workerId,
          processed: totalProcessed,
          hasMore: true
        })
      }

      // Fetch next chunk of unique codes
      const { data: uniqueCodes, error: fetchError } = await supabase
        .from('qr_codes')
        .select('id, variant_id')
        .eq('batch_id', batch.id)
        .eq('status', 'ready_to_ship')
        .eq('is_buffer', false)
        .order('id', { ascending: true })
        .limit(CHUNK_SIZE)

      if (fetchError) {
        console.error(`❌ [${workerId}] Error fetching codes:`, fetchError)
        await markFailed(supabase, batch.id, fetchError.message)
        return NextResponse.json({ error: fetchError.message }, { status: 500 })
      }

      if (!uniqueCodes || uniqueCodes.length === 0) {
        hasMore = false
        console.log(`✅ [${workerId}] No more unique codes to process`)
        break
      }

      console.log(`📦 [${workerId}] Processing chunk of ${uniqueCodes.length} codes (total so far: ${totalProcessed})`)

      // Update this chunk
      const chunkIds = uniqueCodes.map(c => c.id)
      const { error: updateError } = await supabase
        .from('qr_codes')
        .update({ status: 'received_warehouse' })
        .in('id', chunkIds)

      if (updateError) {
        console.error(`❌ [${workerId}] Error updating chunk:`, updateError)
        await markFailed(supabase, batch.id, updateError.message)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      // Accumulate variant counts
      uniqueCodes.forEach(c => {
        if (c.variant_id) {
          cumulativeVariantCounts.set(c.variant_id, (cumulativeVariantCounts.get(c.variant_id) || 0) + 1)
        }
      })

      totalProcessed += uniqueCodes.length
      chunksProcessed++

      // Update heartbeat and progress
      await updateHeartbeat(supabase, batch.id, workerId, totalProcessed)
      console.log(`✅ [${workerId}] Chunk ${chunksProcessed} complete. Progress: ${totalProcessed}`)

      // If we got fewer than CHUNK_SIZE, we're done
      if (uniqueCodes.length < CHUNK_SIZE) {
        hasMore = false
      }
    }

    // Step 4: Record inventory movements
    if (warehouseOrgId && cumulativeVariantCounts.size > 0) {
      console.log(`📊 [${workerId}] Recording inventory for ${cumulativeVariantCounts.size} variants`)
      await recordInventoryMovements(
        supabase, batch.id, warehouseOrgId, manufacturerOrgId, 
        companyId, orderId, orderNo, receivedBy,
        cumulativeVariantCounts, variantPriceMap, warrantyBonusPercent
      )
    }

    // Step 5: Mark as completed
    await supabase
      .from('qr_batches')
      .update({ 
        receiving_status: 'completed',
        receiving_completed_at: new Date().toISOString(),
        receiving_progress: totalProcessed,
        last_error: null
      })
      .eq('id', batch.id)

    console.log(`🎉 [${workerId}] Batch ${batch.id} completed! Total processed: ${totalProcessed}`)
    
    return NextResponse.json({ 
      success: true,
      message: 'Batch receiving completed',
      worker_id: workerId,
      processed: totalProcessed,
      batch_id: batch.id
    })

  } catch (error: any) {
    console.error(`❌ [${workerId}] Worker error:`, error)
    return NextResponse.json({ 
      error: error.message || 'Worker failed',
      worker_id: workerId
    }, { status: 500 })
  }
}

/**
 * Claim a batch for processing with stale detection
 */
async function claimBatch(supabase: any, workerId: string) {
  const now = new Date()
  const staleThreshold = new Date(now.getTime() - STALE_THRESHOLD_MS)

  // First, check for stale processing jobs and mark them as failed
  const { data: staleJobs } = await supabase
    .from('qr_batches')
    .select('id, receiving_heartbeat')
    .eq('receiving_status', 'processing')

  if (staleJobs && staleJobs.length > 0) {
    for (const job of staleJobs) {
      // Check if heartbeat is stale (or null)
      const heartbeat = job.receiving_heartbeat ? new Date(job.receiving_heartbeat) : null
      if (!heartbeat || heartbeat < staleThreshold) {
        console.log(`🔄 [${workerId}] Found stale job ${job.id}, marking as failed`)
        await supabase
          .from('qr_batches')
          .update({ 
            receiving_status: 'failed',
            last_error: 'Worker timeout - no heartbeat for 3+ minutes'
          })
          .eq('id', job.id)
          .eq('receiving_status', 'processing')
      }
    }
  }

  // Try to claim a queued batch (atomic update)
  const { data: queuedBatches } = await supabase
    .from('qr_batches')
    .select('id')
    .eq('receiving_status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)

  if (queuedBatches && queuedBatches.length > 0) {
    const batchId = queuedBatches[0].id
    
    // Atomic claim
    const { data: claimed, error } = await supabase
      .from('qr_batches')
      .update({ 
        receiving_status: 'processing',
        receiving_worker_id: workerId,
        receiving_heartbeat: now.toISOString(),
        receiving_started_at: now.toISOString(),
        receiving_progress: 0
      })
      .eq('id', batchId)
      .eq('receiving_status', 'queued') // Ensure still queued
      .select(`
        id, 
        receiving_status,
        receiving_progress,
        created_by,
        last_error,
        order_id,
        total_unique_codes,
        orders (
          id,
          order_no,
          buyer_org_id,
          seller_org_id,
          company_id,
          order_items (
            variant_id,
            unit_price
          )
        )
      `)
      .single()

    if (claimed) {
      return claimed
    }
  }

  // If no queued batch, try to resume a processing batch owned by this worker or unclaimed
  const { data: existing } = await supabase
    .from('qr_batches')
    .select(`
      id, 
      receiving_status,
      receiving_progress,
      receiving_worker_id,
      receiving_heartbeat,
      created_by,
      last_error,
      order_id,
      total_unique_codes,
      orders (
        id,
        order_no,
        buyer_org_id,
        seller_org_id,
        company_id,
        order_items (
          variant_id,
          unit_price
        )
      )
    `)
    .eq('receiving_status', 'processing')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (existing) {
    // Update heartbeat to claim it
    await supabase
      .from('qr_batches')
      .update({ 
        receiving_worker_id: workerId,
        receiving_heartbeat: now.toISOString()
      })
      .eq('id', existing.id)
    
    console.log(`🔄 [${workerId}] Resuming existing processing job ${existing.id}`)
    return existing
  }

  return null
}

/**
 * Update heartbeat and progress
 */
async function updateHeartbeat(supabase: any, batchId: string, workerId: string, progress: number) {
  const { error } = await supabase
    .from('qr_batches')
    .update({ 
      receiving_heartbeat: new Date().toISOString(),
      receiving_progress: progress,
      receiving_worker_id: workerId
    })
    .eq('id', batchId)
  
  if (error) {
    console.error(`Error updating heartbeat:`, error)
  }
}

/**
 * Mark batch as failed
 */
async function markFailed(supabase: any, batchId: string, error: string) {
  await supabase
    .from('qr_batches')
    .update({ 
      receiving_status: 'failed',
      last_error: error
    })
    .eq('id', batchId)
}

/**
 * Resolve warehouse org ID (handle HQ -> WH mapping)
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

    if (whOrg) {
      console.log(`📍 Resolved Warehouse ID: ${whOrg.id} (from HQ: ${buyerOrgId})`)
      return whOrg.id
    }
  }

  return buyerOrgId
}

/**
 * Process master codes (one-time bulk update)
 */
async function processMasterCodes(
  supabase: any, 
  batchId: string, 
  warehouseOrgId: string,
  manufacturerOrgId: string,
  companyId: string,
  orderId: string,
  receivedBy: string
): Promise<{ processed: number }> {
  const { data: masterCodes } = await supabase
    .from('qr_master_codes')
    .select('id, master_code')
    .eq('batch_id', batchId)
    .eq('status', 'ready_to_ship')
    .limit(5000)

  if (!masterCodes || masterCodes.length === 0) {
    return { processed: 0 }
  }

  // Bulk update
  const { error } = await supabase
    .from('qr_master_codes')
    .update({ status: 'received_warehouse' })
    .eq('batch_id', batchId)
    .eq('status', 'ready_to_ship')

  if (error) {
    console.error('Error updating master codes:', error)
    return { processed: 0 }
  }

  // Log movements
  if (warehouseOrgId && manufacturerOrgId) {
    const movements = masterCodes.map((m: any) => ({
      company_id: companyId,
      qr_master_code_id: m.id,
      movement_type: 'warehouse_receive',
      from_org_id: manufacturerOrgId,
      to_org_id: warehouseOrgId,
      current_status: 'received_warehouse',
      scanned_at: new Date().toISOString(),
      scanned_by: receivedBy,
      related_order_id: orderId,
      notes: `Warehouse receive worker: ${m.master_code}`
    }))

    await supabase.from('qr_movements').insert(movements)
  }

  return { processed: masterCodes.length }
}

/**
 * Record inventory movements after all chunks processed
 */
async function recordInventoryMovements(
  supabase: any,
  batchId: string,
  warehouseOrgId: string,
  manufacturerOrgId: string,
  companyId: string,
  orderId: string,
  orderNo: string,
  receivedBy: string,
  variantCounts: Map<string, number>,
  variantPriceMap: Map<string, number>,
  warrantyBonusPercent: number
) {
  for (const [variantId, quantity] of Array.from(variantCounts.entries())) {
    const unitCost = variantPriceMap.get(variantId) || 0

    // Record stock movement
    await supabase.rpc('record_stock_movement', {
      p_movement_type: 'addition',
      p_variant_id: variantId,
      p_organization_id: warehouseOrgId,
      p_quantity_change: quantity,
      p_unit_cost: unitCost,
      p_manufacturer_id: manufacturerOrgId,
      p_warehouse_location: null,
      p_reason: 'warehouse_receive',
      p_notes: `Batch receive worker ${batchId}`,
      p_reference_type: 'order',
      p_reference_id: orderId,
      p_reference_no: orderNo,
      p_company_id: companyId,
      p_created_by: receivedBy
    })

    // Handle warranty bonus
    const bonusQuantity = Math.floor(quantity * (warrantyBonusPercent / 100))
    if (bonusQuantity > 0) {
      const { data: bufferCodes } = await supabase
        .from('qr_codes')
        .select('id')
        .eq('batch_id', batchId)
        .eq('variant_id', variantId)
        .eq('is_buffer', true)
        .in('status', ['buffer_available', 'available', 'created'])
        .limit(bonusQuantity)

      if (bufferCodes && bufferCodes.length > 0) {
        const bufferIds = bufferCodes.map((b: any) => b.id)
        
        await supabase
          .from('qr_codes')
          .update({ status: 'received_warehouse' })
          .in('id', bufferIds)

        await supabase.rpc('record_stock_movement', {
          p_movement_type: 'warranty_bonus',
          p_variant_id: variantId,
          p_organization_id: warehouseOrgId,
          p_quantity_change: bufferCodes.length,
          p_unit_cost: 0,
          p_manufacturer_id: manufacturerOrgId,
          p_warehouse_location: null,
          p_reason: 'manufacturer_warranty',
          p_notes: `${warrantyBonusPercent}% warranty bonus for order ${orderNo}`,
          p_reference_type: 'order',
          p_reference_id: orderId,
          p_reference_no: orderNo,
          p_company_id: companyId,
          p_created_by: receivedBy
        })
      }
    }
  }
}
