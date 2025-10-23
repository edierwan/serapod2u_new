import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/admin/delete-transactions
 * Delete all transaction data only (keep master data)
 * SUPER ADMIN ONLY (role_level = 1)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if user is Super Admin
    const { data: profile } = await supabase
      .from('users')
      .select('role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    if (!profile || (profile.roles as any).role_level !== 1) {
      return NextResponse.json(
        { error: 'Access denied. Super Admin only.' },
        { status: 403 }
      )
    }

    console.log('🚨 DELETING TRANSACTION DATA - Started by:', user.email)

    let deletedCount = 0

    // Delete in correct order (respecting foreign keys)

    // 1. Delete document workflows
    const { error: docWorkflowError, count: docWorkflowCount } = await supabase
      .from('document_workflows')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all
    
    deletedCount += docWorkflowCount || 0
    console.log(`✓ Deleted ${docWorkflowCount || 0} document workflows`)

    // 2. Delete QR codes (individual)
    const { error: qrCodesError, count: qrCodesCount } = await supabase
      .from('qr_codes')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
    
    deletedCount += qrCodesCount || 0
    console.log(`✓ Deleted ${qrCodesCount || 0} QR codes`)

    // 3. Delete QR master codes
    const { error: masterCodesError, count: masterCodesCount } = await supabase
      .from('qr_master_codes')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
    
    deletedCount += masterCodesCount || 0
    console.log(`✓ Deleted ${masterCodesCount || 0} QR master codes`)

    // 4. Delete QR batches
    const { error: qrBatchesError, count: qrBatchesCount } = await supabase
      .from('qr_batches')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
    
    deletedCount += qrBatchesCount || 0
    console.log(`✓ Deleted ${qrBatchesCount || 0} QR batches`)

    // 5. Delete payments
    const { error: paymentsError, count: paymentsCount } = await supabase
      .from('payments')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
    
    deletedCount += paymentsCount || 0
    console.log(`✓ Deleted ${paymentsCount || 0} payments`)

    // 6. Delete invoices
    const { error: invoicesError, count: invoicesCount } = await supabase
      .from('invoices')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
    
    deletedCount += invoicesCount || 0
    console.log(`✓ Deleted ${invoicesCount || 0} invoices`)

    // 7. Delete shipments
    const { error: shipmentsError, count: shipmentsCount } = await supabase
      .from('shipments')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
    
    deletedCount += shipmentsCount || 0
    console.log(`✓ Deleted ${shipmentsCount || 0} shipments`)

    // 8. Delete order items
    const { error: orderItemsError, count: orderItemsCount } = await supabase
      .from('order_items')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
    
    deletedCount += orderItemsCount || 0
    console.log(`✓ Deleted ${orderItemsCount || 0} order items`)

    // 9. Delete orders
    const { error: ordersError, count: ordersCount } = await supabase
      .from('orders')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
    
    deletedCount += ordersCount || 0
    console.log(`✓ Deleted ${ordersCount || 0} orders`)

    // 10. Delete storage files
    try {
      // Delete QR code files
      const { data: qrFiles } = await supabase.storage
        .from('qr-codes')
        .list()
      
      if (qrFiles && qrFiles.length > 0) {
        const filePaths = qrFiles.map(file => file.name)
        await supabase.storage.from('qr-codes').remove(filePaths)
        console.log(`✓ Deleted ${filePaths.length} QR code files`)
      }

      // Delete document files
      const { data: docFiles } = await supabase.storage
        .from('documents')
        .list()
      
      if (docFiles && docFiles.length > 0) {
        const filePaths = docFiles.map(file => file.name)
        await supabase.storage.from('documents').remove(filePaths)
        console.log(`✓ Deleted ${filePaths.length} document files`)
      }
    } catch (storageError) {
      console.error('Storage deletion error:', storageError)
      // Continue even if storage deletion fails
    }

    console.log(`🎉 TRANSACTION DELETION COMPLETE - Total records deleted: ${deletedCount}`)

    return NextResponse.json({
      success: true,
      deleted_count: deletedCount,
      message: 'All transaction data deleted successfully'
    })

  } catch (error: any) {
    console.error('❌ Transaction deletion error:', error)
    return NextResponse.json(
      { error: 'Failed to delete transactions', details: error.message },
      { status: 500 }
    )
  }
}
