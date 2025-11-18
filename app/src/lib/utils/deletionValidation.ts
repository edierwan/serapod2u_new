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

    return {
      canDelete: true,
      relatedRecords: {
        orderItems: orderItemsCount || 0,
        qrBatchesPending: qrBatchesCount || 0,
        qrCodesPending: pendingQRCount || 0,
        documents: documentsCount || 0
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
    // Delete in correct order (child tables first)
    
    // 1. Delete QR codes (all if forceDelete, otherwise only pending)
    const qrQuery = supabase
      .from('qr_codes')
      .delete()
      .eq('order_id', orderId)
    
    if (!forceDelete) {
      qrQuery.eq('status', 'pending')
    }
    
    const { error: qrError } = await qrQuery

    if (qrError) throw qrError

    // 2. Delete QR batches
    const { error: batchError } = await supabase
      .from('qr_batches')
      .delete()
      .eq('order_id', orderId)

    if (batchError) throw batchError

    // 3. Delete documents
    const { error: docError } = await supabase
      .from('documents')
      .delete()
      .eq('order_id', orderId)

    if (docError) throw docError

    // 4. Delete order items
    const { error: itemsError } = await supabase
      .from('order_items')
      .delete()
      .eq('order_id', orderId)

    if (itemsError) throw itemsError

    // 5. Finally, delete the order
    const { error: orderError } = await supabase
      .from('orders')
      .delete()
      .eq('id', orderId)

    if (orderError) throw orderError

    return { success: true }
  } catch (error) {
    console.error('Error cascade deleting order:', error)
    throw error
  }
}
