import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Allow up to 5 minutes for large batches

// Process codes in chunks to avoid timeout
const CHUNK_SIZE = 10000 // Process 10k codes per chunk

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const supabase = createAdminClient()

  try {
    // 1. Find a batch to process (queued or processing)
    const { data: batch, error: fetchError } = await supabase
      .from('qr_batches')
      .select(`
        id, 
        receiving_status,
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
      .in('receiving_status', ['queued', 'processing'])
      .order('created_at', { ascending: true }) // FIFO
      .limit(1)
      .single()

    if (fetchError || !batch) {
      return NextResponse.json({ message: 'No batches to receive' })
    }

    console.log(`📦 Receiving batch ${batch.id} (Status: ${batch.receiving_status})`)

    const order = batch.orders as any
    let warehouseOrgId = order?.buyer_org_id
    const manufacturerOrgId = order?.seller_org_id
    const companyId = order?.company_id
    const orderId = order?.id
    const orderNo = order?.order_no
    
    // Create price map
    const variantPriceMap = new Map<string, number>()
    if (order?.order_items) {
        order.order_items.forEach((item: any) => {
            if (item.variant_id && item.unit_price != null) {
                variantPriceMap.set(item.variant_id, Number(item.unit_price))
            }
        })
    }
    
    // Fetch manufacturer warranty bonus
    let warrantyBonusPercent = 0
    if (manufacturerOrgId) {
        const { data: mfgOrg } = await supabase
            .from('organizations')
            .select('warranty_bonus')
            .eq('id', manufacturerOrgId)
            .single()
        
        if (mfgOrg?.warranty_bonus) {
            warrantyBonusPercent = Number(mfgOrg.warranty_bonus)
        }
    }

    console.log(`🏭 Manufacturer: ${manufacturerOrgId}, Warranty Bonus: ${warrantyBonusPercent}%`)

    let receivedBy = batch.created_by
    try {
      if (batch.last_error && batch.last_error.includes('received_by')) {
        const meta = JSON.parse(batch.last_error)
        if (meta.received_by) {
          receivedBy = meta.received_by
        }
      }
    } catch (e) {
      // Ignore parse error
    }

    // Resolve correct warehouse ID if buyer is HQ
    if (warehouseOrgId) {
      const { data: buyerOrg } = await supabase
        .from('organizations')
        .select('org_type_code')
        .eq('id', warehouseOrgId)
        .single()
      
      if (buyerOrg?.org_type_code === 'HQ') {
        const { data: whOrg } = await supabase
          .from('organizations')
          .select('id')
          .eq('parent_org_id', warehouseOrgId)
          .eq('org_type_code', 'WH')
          .eq('is_active', true)
          .order('created_at', { ascending: true }) // Prefer older (likely default) if multiple
          .limit(1)
          .single()
          
        if (whOrg) {
          console.log(`📍 Resolved Warehouse ID: ${whOrg.id} (from HQ: ${warehouseOrgId})`)
          warehouseOrgId = whOrg.id
        }
      }
    }

    // 2. Update status to processing if needed
    if (batch.receiving_status === 'queued') {
      const { error: updateError } = await supabase
        .from('qr_batches')
        .update({ receiving_status: 'processing' })
        .eq('id', batch.id)
      
      if (updateError) {
        console.error('Error updating batch status:', updateError)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    }

    // 3. Process ALL items in one go (Bulk Update)
    // This avoids URL length limits with .in() and ensures consolidated movement history
    
    let processedCount = 0

    // --- Update Master Codes ---
    // First, get the IDs to log movements (we need them for qr_movements)
    // If there are too many (> 2000), we might need to chunk, but for now assume reasonable batch size
    const { data: masterCodes, error: masterFetchError } = await supabase
      .from('qr_master_codes')
      .select('id, master_code')
      .eq('batch_id', batch.id)
      .eq('status', 'ready_to_ship')
      .limit(5000) // Safety limit

    if (masterFetchError) {
       console.error('Error fetching master codes:', masterFetchError)
       return NextResponse.json({ error: masterFetchError.message }, { status: 500 })
    }

    if (masterCodes && masterCodes.length > 0) {
        // Bulk update by batch_id
        const { error: masterUpdateError } = await supabase
          .from('qr_master_codes')
          .update({ status: 'received_warehouse' })
          .eq('batch_id', batch.id)
          .eq('status', 'ready_to_ship')
        
        if (masterUpdateError) {
            console.error('Error updating master codes:', masterUpdateError)
            return NextResponse.json({ error: masterUpdateError.message }, { status: 500 })
        }

        // Log movements
        if (warehouseOrgId && manufacturerOrgId) {
            const movements = masterCodes.map(m => ({
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
            
            const { error: movementError } = await supabase
                .from('qr_movements')
                .insert(movements)
                
            if (movementError) {
                console.error('Error logging movements:', movementError)
            }
        }
        processedCount += masterCodes.length
    }

    // --- Update Unique Codes ---
    // Process in chunks to handle large batches (e.g., 165,000 codes)
    // We use a loop to process CHUNK_SIZE codes at a time until all are done
    
    let totalUniqueProcessed = 0
    let hasMoreUniqueCodes = true
    
    // Track inventory changes across all chunks to consolidate at the end
    const cumulativeVariantCounts = new Map<string, number>()
    
    console.log(`🔄 Starting unique code processing for batch ${batch.id}. Total expected: ${batch.total_unique_codes || 'unknown'}`)
    
    while (hasMoreUniqueCodes) {
        // Check if we're running out of time (leave 30s buffer for final operations)
        const elapsed = Date.now() - startTime
        if (elapsed > 270000) { // 4.5 minutes
            console.log(`⏱️ Time limit approaching. Processed ${totalUniqueProcessed} unique codes so far. Will continue on next run.`)
            return NextResponse.json({ 
                message: 'Partial processing completed', 
                processed: processedCount + totalUniqueProcessed,
                hasMore: true 
            })
        }
        
        // Fetch next chunk of unique codes (NON-BUFFER only)
        const { data: uniqueCodes, error: uniqueFetchError } = await supabase
            .from('qr_codes')
            .select('id, variant_id, is_buffer')
            .eq('batch_id', batch.id)
            .eq('status', 'ready_to_ship')
            .eq('is_buffer', false) // Only normal codes
            .limit(CHUNK_SIZE)

        if (uniqueFetchError) {
            console.error('Error fetching unique codes:', uniqueFetchError)
            return NextResponse.json({ error: uniqueFetchError.message }, { status: 500 })
        }

        // If no more codes to process, exit the loop
        if (!uniqueCodes || uniqueCodes.length === 0) {
            hasMoreUniqueCodes = false
            console.log(`✅ No more unique codes to process. Total processed: ${totalUniqueProcessed}`)
            break
        }

        console.log(`📦 Processing chunk of ${uniqueCodes.length} unique codes...`)

        // Get IDs for this chunk
        const chunkIds = uniqueCodes.map(c => c.id)
        
        // Bulk update this chunk by IDs (more precise than batch_id filter)
        const { error: uniqueUpdateError } = await supabase
            .from('qr_codes')
            .update({ status: 'received_warehouse' })
            .in('id', chunkIds)
        
        if (uniqueUpdateError) {
            console.error('Error updating unique codes chunk:', uniqueUpdateError)
            return NextResponse.json({ error: uniqueUpdateError.message }, { status: 500 })
        }

        // Accumulate variant counts for inventory
        uniqueCodes.forEach(c => {
            if (c.variant_id) {
                cumulativeVariantCounts.set(c.variant_id, (cumulativeVariantCounts.get(c.variant_id) || 0) + 1)
            }
        })

        totalUniqueProcessed += uniqueCodes.length
        console.log(`✅ Chunk complete. Total unique codes processed: ${totalUniqueProcessed}`)
        
        // If we got fewer than CHUNK_SIZE, we're done
        if (uniqueCodes.length < CHUNK_SIZE) {
            hasMoreUniqueCodes = false
        }
    }

    // Update Inventory (Consolidated after all chunks)
    if (warehouseOrgId && cumulativeVariantCounts.size > 0) {
        console.log(`📊 Recording inventory for ${cumulativeVariantCounts.size} variants...`)
        
        for (const [variantId, quantity] of Array.from(cumulativeVariantCounts.entries())) {
             // 1. Record standard movement
             const unitCost = variantPriceMap.get(variantId) || 0

             await supabase.rpc('record_stock_movement', {
                p_movement_type: 'addition',
                p_variant_id: variantId,
                p_organization_id: warehouseOrgId,
                p_quantity_change: quantity,
                p_unit_cost: unitCost,
                p_manufacturer_id: manufacturerOrgId,
                p_warehouse_location: null,
                p_reason: 'warehouse_receive',
                p_notes: `Batch receive worker ${batch.id}`,
                p_reference_type: 'order',
                p_reference_id: orderId,
                p_reference_no: orderNo,
                p_company_id: companyId,
                p_created_by: receivedBy
              })

             // 2. Handle Warranty Bonus (Dynamic %)
             // We need to find and activate specific buffer codes for this
             const bonusQuantity = Math.floor(quantity * (warrantyBonusPercent / 100))
             
             if (bonusQuantity > 0) {
                 console.log(`Activating ${bonusQuantity} buffer codes for variant ${variantId} (Bonus: ${warrantyBonusPercent}%)`)
                 
                 // Find available buffer codes
                 const { data: bufferCodesToActivate } = await supabase
                    .from('qr_codes')
                    .select('id')
                    .eq('batch_id', batch.id)
                    .eq('variant_id', variantId)
                    .eq('is_buffer', true)
                    .in('status', ['buffer_available', 'available', 'created']) // Check all possible initial statuses
                    .limit(bonusQuantity)
                 
                 if (bufferCodesToActivate && bufferCodesToActivate.length > 0) {
                     const bufferIds = bufferCodesToActivate.map(b => b.id)
                     
                     // Activate these buffer codes
                     const { error: updateError } = await supabase
                        .from('qr_codes')
                        .update({ status: 'received_warehouse' }) // Mark as received/active
                        .in('id', bufferIds)

                     if (updateError) {
                         console.error('Error activating buffer codes:', updateError)
                     } else {
                         // Record warranty bonus movement
                         const bonusCost = 0
                         const { error: allocError } = await supabase.rpc('record_stock_movement', {
                            p_movement_type: 'warranty_bonus', // NEW TYPE
                            p_variant_id: variantId,
                            p_organization_id: warehouseOrgId,
                            p_quantity_change: bufferCodesToActivate.length, // Use actual count found
                            p_unit_cost: bonusCost, // ZERO COST
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
                          
                          if (allocError) {
                              console.error('Error creating warranty bonus movement:', allocError)
                          } else {
                              console.log(`✅ Recorded warranty bonus movement for ${bufferCodesToActivate.length} items`)
                          }
                     }
                 } else {
                     console.warn(`⚠️ No buffer codes found for variant ${variantId} to activate warranty (Needed: ${bonusQuantity})`)
                 }
             }
        }
    }
    
    processedCount += totalUniqueProcessed

    // 4. Mark as completed
    await supabase
      .from('qr_batches')
      .update({ 
        receiving_status: 'completed',
        last_error: null // Clear the temporary metadata
      })
      .eq('id', batch.id)
    
    console.log(`✅ Batch ${batch.id} receiving completed. Processed: ${processedCount}`)
    return NextResponse.json({ message: 'Batch receiving completed', processed: processedCount })

  } catch (error) {
    console.error('Worker error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
