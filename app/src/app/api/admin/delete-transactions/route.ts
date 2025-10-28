import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/admin/delete-transactions
 * Delete all transaction data including inventory and reset order sequences
 * SUPER ADMIN ONLY (role_level = 1)
 */
export const dynamic = 'force-dynamic'

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

    console.log('🚨 DELETING ALL TRANSACTION DATA + INVENTORY - Started by:', user.email)

    // Call the enhanced RPC function that deletes everything in a single transaction
    const { data: result, error: rpcError } = await supabase
      .rpc('delete_all_transactions_with_inventory')

    if (rpcError) {
      console.error('❌ RPC deletion error:', rpcError)
      return NextResponse.json(
        { error: 'Failed to delete transactions: ' + rpcError.message, details: rpcError },
        { status: 500 }
      )
    }

    if (!result) {
      console.error('❌ RPC returned no result')
      return NextResponse.json(
        { error: 'RPC function returned no result' },
        { status: 500 }
      )
    }

    console.log('✅ Deletion result:', result)

    // Delete storage files (QR codes and documents)
    let storageDeletedCount = 0
    
    try {
      // Delete QR code files
      const { data: qrFiles } = await supabase.storage
        .from('qr-codes')
        .list()
      
      if (qrFiles && qrFiles.length > 0) {
        const filePaths = qrFiles.map(file => file.name)
        await supabase.storage.from('qr-codes').remove(filePaths)
        storageDeletedCount += filePaths.length
        console.log(`✓ Deleted ${filePaths.length} QR code files`)
      }

      // Delete document files
      const { data: docFiles } = await supabase.storage
        .from('documents')
        .list()
      
      if (docFiles && docFiles.length > 0) {
        const filePaths = docFiles.map(file => file.name)
        await supabase.storage.from('documents').remove(filePaths)
        storageDeletedCount += filePaths.length
        console.log(`✓ Deleted ${filePaths.length} document files`)
      }
    } catch (storageError) {
      console.error('Storage deletion error:', storageError)
      // Continue even if storage deletion fails
    }

    console.log(`🎉 COMPLETE DELETION FINISHED`)
    console.log(`📊 Database records: ${result.total_records}`)
    console.log(`📁 Storage files: ${storageDeletedCount}`)
    console.log(`🔄 Order sequences RESET - Next order will be 01`)

    return NextResponse.json({
      success: true,
      deleted_count: result.total_records,
      deleted_counts: result.deleted_counts,
      storage_files_deleted: storageDeletedCount,
      message: result.message
    })

  } catch (error: any) {
    console.error('❌ Transaction deletion error:', error)
    return NextResponse.json(
      { error: 'Failed to delete transactions', details: error.message },
      { status: 500 }
    )
  }
}
