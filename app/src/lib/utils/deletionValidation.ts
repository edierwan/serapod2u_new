// Deletion validation utilities
import { SupabaseClient } from '@supabase/supabase-js'

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

    // 5. Delete stock movements related to this order
    // First, get the order number for reference_no matching
    const { data: orderData } = await supabase
      .from('orders')
      .select('order_no')
      .eq('id', orderId)
      .single()
    
    const orderNo = orderData?.order_no
    
    console.log(`🗑️ Looking for stock movements with order_id: ${orderId} or order_no: ${orderNo}`)
    
    // Query all movements that match this order (before deletion for logging)
    const { data: movementsToDelete, error: queryError } = await supabase
      .from('stock_movements')
      .select('id, reference_type, reference_id, reference_no, reason, notes')
      .eq('reference_type', 'order')
      .or(`reference_id.eq.${orderId},reference_no.eq.${orderNo}`)
    
    if (queryError) {
      console.error('❌ Error querying stock movements:', queryError)
    } else {
      console.log(`📋 Found ${movementsToDelete?.length || 0} stock movements to delete:`, movementsToDelete)
    }
    
    // Delete all movements for this order using OR condition
    const { error: movementsError, count: movementsCount } = await supabase
      .from('stock_movements')
      .delete()
      .eq('reference_type', 'order')
      .or(`reference_id.eq.${orderId},reference_no.eq.${orderNo}`)

    if (movementsError) {
      console.error('❌ Error deleting stock movements:', movementsError)
      throw movementsError
    }
    console.log(`✅ Deleted ${movementsCount || 0} stock movements`)

    // 6. Delete order items
    const { error: itemsError, count: itemsCount } = await supabase
      .from('order_items')
      .delete()
      .eq('order_id', orderId)

    if (itemsError) {
      console.error('❌ Error deleting order items:', itemsError)
      throw itemsError
    }
    console.log(`✅ Deleted ${itemsCount || 0} order items`)

    // 7. Finally, delete the order
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
