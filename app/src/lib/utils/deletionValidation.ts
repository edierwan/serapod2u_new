// Deletion validation utilities
import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Check if an order can be deleted
 * Returns canDelete = false if any QR codes have been scanned/activated
 */
export async function validateOrderDeletion(supabase: SupabaseClient, orderId: string) {
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
      return {
        canDelete: false,
        reason: 'QR_CODES_SCANNED',
        message: `This order cannot be deleted because ${scannedQR.length} QR code(s) have already been scanned by the manufacturer. Once QR codes are scanned, the order becomes part of the audit trail.`,
        scannedCodes: scannedQR
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
 */
export async function cascadeDeleteOrder(supabase: SupabaseClient, orderId: string) {
  try {
    // Delete in correct order (child tables first)
    
    // 1. Delete pending QR codes
    const { error: qrError } = await supabase
      .from('qr_codes')
      .delete()
      .eq('order_id', orderId)
      .eq('status', 'pending')

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
