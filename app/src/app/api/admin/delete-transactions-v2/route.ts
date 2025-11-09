import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/admin/delete-transactions-v2
 * Delete all transaction data including inventory and reset order sequences
 * SUPER ADMIN ONLY (role_level = 1)
 * 
 * OPTIMIZED V2: Uses a more robust batched deletion function to handle large datasets 
 * without timeouts, and with a longer max duration.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes - shorter to avoid Vercel timeout

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

    if (!profile || !(profile as any).roles || (profile as any).roles.role_level !== 1) {
      return NextResponse.json(
        { error: 'Access denied. Super Admin only.' },
        { status: 403 }
      )
    }

    console.log('🚨 DELETING ALL TRANSACTION DATA + INVENTORY (V2) - Started by:', user.email)

    // Call the new optimized RPC function
    const { data: result, error: rpcError } = await supabase
      .rpc('delete_all_transactions_with_inventory_v3')

    if (rpcError) {
      console.error('❌ V2 RPC deletion error:', rpcError)
      return NextResponse.json(
        { error: 'Failed to delete transactions: ' + rpcError.message, details: rpcError },
        { status: 500 }
      )
    }

    if (!result) {
      console.error('❌ V2 RPC returned no result')
      return NextResponse.json(
        { error: 'RPC function returned no result' },
        { status: 500 }
      )
    }

    console.log('✅ V2 Deletion result:', result)
    
    // The new function also handles storage cleanup.
    const totalRecords = (result as any).total_records_deleted || 0
    const storageFilesDeleted = (result as any).storage_files_deleted || 0

    console.log(`\n🎉 V2 COMPLETE DELETION FINISHED`)
    console.log(`📊 Total database records deleted: ${totalRecords}`)
    console.log(`📁 Storage files deleted: ${storageFilesDeleted}`)
    console.log(`🔄 Order sequences RESET - Next order will be 01`)

    return NextResponse.json({
      success: true,
      deleted_count: totalRecords,
      storage_files_deleted: storageFilesDeleted,
      message: `Deleted ${totalRecords} records and ${storageFilesDeleted} storage files.`
    })

  } catch (error: any) {
    console.error('❌ V2 Transaction deletion error:', error)
    return NextResponse.json(
      { error: 'Failed to delete transactions', details: error.message },
      { status: 500 }
    )
  }
}
