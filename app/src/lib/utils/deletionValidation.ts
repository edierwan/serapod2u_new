// Deletion validation utilities
import { SupabaseClient } from '@supabase/supabase-js'

type StockMovementSnapshot = {
  id: string
  variant_id: string | null
  quantity_change: number | null
  to_organization_id: string | null
  from_organization_id: string | null
  movement_type: string | null
  notes: string | null
}

/**
 * Check if an order can be deleted
 * Returns canDelete = false if any QR codes have been scanned/activated
 * Super admins can override this with a force delete option
 */
export async function validateOrderDeletion(supabase: SupabaseClient, orderId: string, isSuperAdmin: boolean = false) {
  try {
    // Check for scanned/activated QR codes
    const { data: scannedQR, error: qrError } = await supabase
      .from('qr_codes')
      .select('id, code, status, last_scanned_at, activated_at')
      .eq('order_id', orderId)
      .neq('status', 'pending')  // Any status other than pending means it's been scanned
      .limit(10)

    if (qrError) throw qrError

    if (scannedQR && scannedQR.length > 0) {
      // Count all scanned QR codes
      const { count: totalScannedCount } = await supabase
        .from('qr_codes')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', orderId)
        .neq('status', 'pending')

      return {
        canDelete: false,
        reason: 'QR_CODES_SCANNED',
        message: isSuperAdmin 
          ? `⚠️ WARNING: This order has ${totalScannedCount || scannedQR.length} scanned QR code(s). Deleting will remove these from the database and may affect audit trail. Only super admins can proceed with this deletion.`
          : `This order cannot be deleted because ${totalScannedCount || scannedQR.length} QR code(s) have already been scanned. Once QR codes are scanned, the order becomes part of the audit trail. Contact a super admin if deletion is absolutely necessary.`,
        scannedCodes: scannedQR,
        requiresSuperAdmin: true,
        scannedCount: totalScannedCount || scannedQR.length
      }
    }

    // Count pending QR codes (these CAN be deleted)
    const { count: pendingQRCount, error: countError } = await supabase
      .from('qr_codes')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .eq('status', 'pending')

    if (countError) throw countError

    // Count related records that will be cascade deleted
    const { count: orderItemsCount } = await supabase
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)

    const { count: qrBatchesCount } = await supabase
      .from('qr_batches')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)

    const { count: documentsCount } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)

    // Get order number for comprehensive movement counting
    const { data: orderData } = await supabase
      .from('orders')
      .select('order_no')
      .eq('id', orderId)
      .single()
    
    // Count movements by reference_id
    const { count: stockMovementsCount1 } = await supabase
      .from('stock_movements')
      .select('id', { count: 'exact', head: true })
      .eq('reference_type', 'order')
      .eq('reference_id', orderId)
    
    // Count movements by reference_no (order number)
    let stockMovementsCount2 = 0
    if (orderData?.order_no) {
      const { count: count2 } = await supabase
        .from('stock_movements')
        .select('id', { count: 'exact', head: true })
        .eq('reference_type', 'order')
        .eq('reference_no', orderData.order_no)
      stockMovementsCount2 = count2 || 0
    }

    return {
      canDelete: true,
      relatedRecords: {
        orderItems: orderItemsCount || 0,
        qrBatchesPending: qrBatchesCount || 0,
        qrCodesPending: pendingQRCount || 0,
        documents: documentsCount || 0,
        stockMovements: (stockMovementsCount1 || 0) + stockMovementsCount2
      }
    }
  } catch (error) {
    console.error('Error validating order deletion:', error)
    throw error
  }
}

/**
 * Cascade delete an order and all related records
 * ONLY call this after validateOrderDeletion returns canDelete = true
 * @param forceDelete - If true, deletes ALL QR codes including scanned ones (super admin only)
 */
export async function cascadeDeleteOrder(supabase: SupabaseClient, orderId: string, forceDelete: boolean = false) {
  try {
    console.log(`🗑️ Starting cascade delete for order: ${orderId}, forceDelete: ${forceDelete}`)
    
    // Delete in correct order (child tables first)
    
    // 1. Delete QR codes (all if forceDelete, otherwise only pending)
    const qrQuery = supabase
      .from('qr_codes')
      .delete()
      .eq('order_id', orderId)
    
    if (!forceDelete) {
      qrQuery.eq('status', 'pending')
    }
    
    const { error: qrError, count: qrCount } = await qrQuery

    if (qrError) {
      console.error('❌ Error deleting QR codes:', qrError)
      throw qrError
    }
    console.log(`✅ Deleted ${qrCount || 0} QR codes`)

    // 1b. Delete QR master codes
    const { error: masterError, count: masterCount } = await supabase
      .from('qr_master_codes')
      .delete()
      .eq('shipment_order_id', orderId)

    if (masterError) {
      console.error('❌ Error deleting QR master codes:', masterError)
      throw masterError
    }
    console.log(`✅ Deleted ${masterCount || 0} QR master codes`)

    // 2. Delete QR batches
    const { error: batchError, count: batchCount } = await supabase
      .from('qr_batches')
      .delete()
      .eq('order_id', orderId)

    if (batchError) {
      console.error('❌ Error deleting QR batches:', batchError)
      throw batchError
    }
    console.log(`✅ Deleted ${batchCount || 0} QR batches`)

    // 3. Delete document files first (they reference documents)
    const { data: documents } = await supabase
      .from('documents')
      .select('id')
      .eq('order_id', orderId)

    if (documents && documents.length > 0) {
      const documentIds = documents.map(doc => doc.id)
      const { error: filesError } = await supabase
        .from('document_files')
        .delete()
        .in('document_id', documentIds)

      if (filesError) {
        console.warn('Warning: Could not delete document files:', filesError)
        // Continue anyway - might not have any files
      }
    }

    // 4. Delete documents
    const { error: docError, count: docCount } = await supabase
      .from('documents')
      .delete()
      .eq('order_id', orderId)

    if (docError) {
      console.error('❌ Error deleting documents:', docError)
      throw docError
    }
    console.log(`✅ Deleted ${docCount || 0} documents`)

    // 5. Release inventory allocation if order has allocated inventory (D2H/S2D orders)
    const { data: orderData } = await supabase
      .from('orders')
      .select('order_no, order_type, status')
      .eq('id', orderId)
      .single()
    
    const orderNo = orderData?.order_no
    
    // If it's a D2H or S2D order that was submitted (not yet approved), release allocation
    if (orderData && ['D2H', 'S2D'].includes(orderData.order_type)) {
      // Check status case-insensitively and allow 'submitted' or similar statuses
      const status = orderData.status?.toLowerCase()
      const shouldRelease = status === 'draft' || status === 'submitted' || status === 'pending' || status === 'processing'
      
      if (shouldRelease) {
        console.log(`🔓 Releasing inventory allocation for ${orderData.order_type} order: ${orderNo} (status: ${orderData.status})`)
        try {
          const { error: releaseError } = await supabase
            .rpc('release_allocation_for_order', { p_order_id: orderId })
          
          if (releaseError) {
            console.warn('⚠️ Warning: Could not release allocation:', releaseError)
            // Continue anyway - deletion should still proceed
          } else {
            console.log('✅ Allocation released successfully')
          }
        } catch (err) {
          console.warn('⚠️ Warning: Error releasing allocation:', err)
          // Continue anyway
        }
      }
    }
    
    // 6. Delete stock movements related to this order
    console.log(`🗑️ Deleting stock movements for order_id: ${orderId}, order_no: ${orderNo}`)

    // Capture movement snapshots before deletion so we can roll back inventory balances
    const movementSnapshotMap = new Map<string, StockMovementSnapshot>()

    console.log(`🔍 Fetching stock movements for snapshot. OrderId: ${orderId}, OrderNo: ${orderNo}`)

    const { data: movementsById, error: snapshotError1 } = await supabase
      .from('stock_movements')
      .select('id, variant_id, quantity_change, to_organization_id, from_organization_id, movement_type, notes')
      .eq('reference_id', orderId)

    if (snapshotError1) {
      console.error('❌ Error fetching stock movements by reference_id:', snapshotError1)
    } else {
      console.log(`Found ${movementsById?.length || 0} movements by reference_id`)
      movementsById?.forEach(row => {
        if (row?.id) movementSnapshotMap.set(row.id, row as StockMovementSnapshot)
      })
    }

    if (orderNo) {
      const { data: movementsByNo, error: snapshotError2 } = await supabase
        .from('stock_movements')
        .select('id, variant_id, quantity_change, to_organization_id, from_organization_id, movement_type, notes')
        .eq('reference_no', orderNo)

      if (snapshotError2) {
        console.error('❌ Error fetching stock movements by reference_no:', snapshotError2)
      } else {
        console.log(`Found ${movementsByNo?.length || 0} movements by reference_no`)
        movementsByNo?.forEach(row => {
          if (row?.id && !movementSnapshotMap.has(row.id)) {
            movementSnapshotMap.set(row.id, row as StockMovementSnapshot)
          }
        })
      }
    }
    
    console.log(`📸 Total unique movements captured for rollback: ${movementSnapshotMap.size}`)
    movementSnapshotMap.forEach((m, id) => {
      console.log(`  - Movement ${id}: Type=${m.movement_type}, Qty=${m.quantity_change}, Notes=${m.notes}`)
    })

    // First attempt: Delete by reference_id (UUID)
    const { error: movementsError1, count: movementsCount1 } = await supabase
      .from('stock_movements')
      .delete()
      .eq('reference_id', orderId)
    
    if (movementsError1) {
      console.error('❌ Error deleting stock movements by reference_id:', movementsError1)
    } else {
      console.log(`✅ Deleted ${movementsCount1 || 0} stock movements by reference_id`)
    }
    
    // Second attempt: Delete by reference_no (order number)
    let movementsCount2 = 0
    if (orderNo) {
      const { error: movementsError2, count: count2 } = await supabase
        .from('stock_movements')
        .delete()
        .eq('reference_no', orderNo)
      
      if (movementsError2) {
        console.error('❌ Error deleting stock movements by reference_no:', movementsError2)
      } else {
        movementsCount2 = count2 || 0
        console.log(`✅ Deleted ${movementsCount2} stock movements by reference_no`)
      }
    }
    
    const totalMovements = (movementsCount1 || 0) + movementsCount2
    console.log(`✅ Total stock movements deleted: ${totalMovements}`)

    // Apply inverse adjustments to product_inventory
    const inventoryAdjustments = new Map<string, { variantId: string; orgId: string; delta: number }>()
    const allocationAdjustments = new Map<string, { variantId: string; orgId: string; delta: number }>()

    movementSnapshotMap.forEach(snapshot => {
      if (!snapshot?.variant_id || typeof snapshot.quantity_change !== 'number') {
        return
      }
      // Resolve targetOrg with fallback for allocation
      let targetOrg = snapshot.quantity_change >= 0
        ? snapshot.to_organization_id
        : snapshot.from_organization_id

      const isAllocation = 
        snapshot.movement_type?.toLowerCase() === 'allocation' || 
        snapshot.movement_type?.toLowerCase() === 'deallocation' ||
        (snapshot.notes && snapshot.notes.toLowerCase().includes('allocation'))

      if (isAllocation && !targetOrg) {
        targetOrg = snapshot.from_organization_id || snapshot.to_organization_id
      }

      if (!targetOrg) {
        console.warn(`⚠️ Skipping movement ${snapshot.id}: No target organization found.`)
        return
      }

      const key = `${snapshot.variant_id}:${targetOrg}`
      
      if (isAllocation) {
        // Normalize delta to ensure consistent sign convention (New Logic: Allocation is negative, Deallocation is positive)
        let normalizedDelta = snapshot.quantity_change
        const type = snapshot.movement_type?.toLowerCase()

        if (type === 'allocation' && normalizedDelta > 0) {
          console.log(`  -> Normalizing positive allocation to negative: ${normalizedDelta} -> ${-normalizedDelta}`)
          normalizedDelta = -normalizedDelta
        } else if (type === 'deallocation' && normalizedDelta < 0) {
          console.log(`  -> Normalizing negative deallocation to positive: ${normalizedDelta} -> ${-normalizedDelta}`)
          normalizedDelta = -normalizedDelta
        }

        const existing = allocationAdjustments.get(key)
        const newDelta = (existing?.delta ?? 0) + normalizedDelta
        allocationAdjustments.set(key, {
          variantId: snapshot.variant_id,
          orgId: targetOrg,
          delta: newDelta
        })
        console.log(`  -> Identified as ALLOCATION adjustment. Key=${key}, RawDelta=${snapshot.quantity_change}, NormDelta=${normalizedDelta}, NewTotal=${newDelta}`)
      } else {
        // Other movements affect quantity_on_hand
        const existing = inventoryAdjustments.get(key)
        const newDelta = (existing?.delta ?? 0) + snapshot.quantity_change
        inventoryAdjustments.set(key, {
          variantId: snapshot.variant_id,
          orgId: targetOrg,
          delta: newDelta
        })
        console.log(`  -> Identified as ON-HAND adjustment. Key=${key}, Delta=${snapshot.quantity_change}, NewTotal=${newDelta}`)
      }
    })

    // Process On-Hand Adjustments
    for (const adjustment of inventoryAdjustments.values()) {
      const { variantId, orgId, delta } = adjustment
      try {
        const { data: inventoryRow, error: inventoryFetchError } = await supabase
          .from('product_inventory')
          .select('id, quantity_on_hand, quantity_available, units_on_hand, total_value, average_cost')
          .eq('variant_id', variantId)
          .eq('organization_id', orgId)
          .maybeSingle()

        if (inventoryFetchError) {
          console.error(`❌ Failed to fetch inventory row for variant ${variantId} org ${orgId}`, inventoryFetchError)
          continue
        }

        if (!inventoryRow) {
          console.warn(`⚠️ No inventory row found for variant ${variantId} org ${orgId} during delete rollback`)
          continue
        }

        const newQuantityOnHand = Math.max(0, (inventoryRow.quantity_on_hand ?? 0) - delta)
        const newQuantityAvailable = inventoryRow.quantity_available !== null
          ? Math.max(0, (inventoryRow.quantity_available ?? 0) - delta)
          : null
        const newUnitsOnHand = inventoryRow.units_on_hand !== null
          ? Math.max(0, (inventoryRow.units_on_hand ?? 0) - delta)
          : null

        const shouldDeleteInventoryRow =
          newQuantityOnHand <= 0 &&
          (newQuantityAvailable ?? 0) <= 0 &&
          (newUnitsOnHand ?? 0) <= 0

        if (shouldDeleteInventoryRow) {
          const { error: inventoryDeleteError } = await supabase
            .from('product_inventory')
            .delete()
            .eq('id', inventoryRow.id)

          if (inventoryDeleteError) {
            console.error(`❌ Failed to delete inventory row for variant ${variantId} org ${orgId}`, inventoryDeleteError)
          } else {
            console.log(`🧹 Removed inventory row for variant ${variantId} org ${orgId} (quantity returned to 0) `)
          }
          continue
        }

        const updatePayload: Record<string, number | string | null> = {
          quantity_on_hand: newQuantityOnHand,
          updated_at: new Date().toISOString()
        }

        // quantity_available is a generated column, do not update it manually
        // if (newQuantityAvailable !== null) {
        //   updatePayload.quantity_available = newQuantityAvailable
        // }

        if (newUnitsOnHand !== null) {
          updatePayload.units_on_hand = newUnitsOnHand
        }

        if (inventoryRow.total_value !== null && inventoryRow.average_cost !== null) {
          updatePayload.total_value = Math.max(0, newQuantityOnHand * (inventoryRow.average_cost ?? 0))
        }

        const { error: inventoryUpdateError } = await supabase
          .from('product_inventory')
          .update(updatePayload)
          .eq('id', inventoryRow.id)

        if (inventoryUpdateError) {
          console.error(`❌ Failed to update inventory for variant ${variantId} org ${orgId}`, inventoryUpdateError)
        } else {
          console.log(`🔄 Adjusted inventory for variant ${variantId} org ${orgId} by delta ${delta}`)
        }
      } catch (inventoryError) {
        console.error(`❌ Exception adjusting inventory for variant ${variantId} org ${orgId}`, inventoryError)
      }
    }

    // Process Allocation Adjustments
    for (const adjustment of allocationAdjustments.values()) {
      const { variantId, orgId, delta } = adjustment
      console.log(`Processing Allocation Adjustment: Variant=${variantId}, Org=${orgId}, Delta=${delta}`)
      if (delta === 0) {
        console.log('  -> Delta is 0, skipping.')
        continue // No net change
      }

      try {
        const { data: inventoryRow, error: inventoryFetchError } = await supabase
          .from('product_inventory')
          .select('id, quantity_allocated, quantity_available')
          .eq('variant_id', variantId)
          .eq('organization_id', orgId)
          .maybeSingle()

        if (inventoryFetchError || !inventoryRow) {
          console.warn(`⚠️ Could not fetch inventory for allocation rollback: ${variantId} @ ${orgId}`)
          continue
        }

        console.log(`  -> Current Inventory: Allocated=${inventoryRow.quantity_allocated}, Available=${inventoryRow.quantity_available}`)

        // Allocation movements are negative (reducing available).
        // Deallocation movements are positive (increasing available).
        // delta is the sum of quantity_change of deleted movements.
        
        // If we delete an allocation (negative change), delta is negative.
        // We want to REVERT the allocation:
        // 1. Decrease quantity_allocated. (allocated + delta, since delta is negative)
        // 2. Increase quantity_available. (available - delta, since delta is negative)
        
        const newAllocated = Math.max(0, (inventoryRow.quantity_allocated ?? 0) + delta)
        const newAvailable = (inventoryRow.quantity_available ?? 0) - delta

        console.log(`  -> New Values: Allocated=${newAllocated}, Available=${newAvailable}`)

        const { error: updateError } = await supabase
          .from('product_inventory')
          .update({
            quantity_allocated: newAllocated,
            // quantity_available: newAvailable, // Generated column, do not update
            updated_at: new Date().toISOString()
          })
          .eq('id', inventoryRow.id)

        if (updateError) {
          console.error(`❌ Failed to update allocation for variant ${variantId} org ${orgId}`, updateError)
        } else {
          console.log(`🔄 Adjusted allocation for variant ${variantId} org ${orgId} by delta ${delta}`)
        }

      } catch (err) {
        console.error(`❌ Exception adjusting allocation for variant ${variantId} org ${orgId}`, err)
      }
    }

    // 7. Delete order items
    const { error: itemsError, count: itemsCount } = await supabase
      .from('order_items')
      .delete()
      .eq('order_id', orderId)

    if (itemsError) {
      console.error('❌ Error deleting order items:', itemsError)
      throw itemsError
    }
    console.log(`✅ Deleted ${itemsCount || 0} order items`)

    // 8. Finally, delete the order
    const { error: orderError, count: orderCount } = await supabase
      .from('orders')
      .delete()
      .eq('id', orderId)

    if (orderError) {
      console.error('❌ Error deleting order:', orderError)
      throw orderError
    }
    console.log(`✅ Deleted ${orderCount || 0} order record(s)`)
    console.log('🎉 Cascade delete completed successfully')

    return { success: true }
  } catch (error) {
    console.error('Error cascade deleting order:', error)
    throw error
  }
}
