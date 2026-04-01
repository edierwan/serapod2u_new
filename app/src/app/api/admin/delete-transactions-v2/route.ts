import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { assertDestructiveOpsAllowed } from '@/lib/server/destructive-ops-guard'

/**
 * POST /api/admin/delete-transactions-v2
 * Delete all transaction data including inventory and reset order sequences
 * Also cleans up storage files (order-documents, qr-codes buckets)
 * SUPER ADMIN ONLY (role_level = 1)
 * 
 * OPTIMIZED V2: Uses a more robust batched deletion function to handle large datasets 
 * without timeouts, and with a longer max duration.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes - shorter to avoid Vercel timeout

/**
 * Helper function to delete all files from a storage bucket
 */
async function deleteAllFilesFromBucket(supabase: any, bucketName: string): Promise<number> {
  let totalDeleted = 0
  
  try {
    // List all files in the bucket (including nested folders)
    const { data: files, error: listError } = await supabase.storage
      .from(bucketName)
      .list('', { limit: 1000 })
    
    if (listError) {
      console.warn(`⚠️ Could not list files in ${bucketName}:`, listError.message)
      return 0
    }
    
    if (!files || files.length === 0) {
      console.log(`📁 ${bucketName}: No files to delete`)
      return 0
    }
    
    // Separate folders and files
    const folders = files.filter((f: any) => f.id === null || f.metadata === null)
    const directFiles = files.filter((f: any) => f.id !== null && f.metadata !== null)
    
    // Delete direct files first
    if (directFiles.length > 0) {
      const filePaths = directFiles.map((f: any) => f.name)
      const { error: deleteError } = await supabase.storage
        .from(bucketName)
        .remove(filePaths)
      
      if (deleteError) {
        console.warn(`⚠️ Error deleting files from ${bucketName}:`, deleteError.message)
      } else {
        totalDeleted += directFiles.length
        console.log(`🗑️ ${bucketName}: Deleted ${directFiles.length} files`)
      }
    }
    
    // Process folders recursively
    for (const folder of folders) {
      const folderDeleted = await deleteFilesInFolder(supabase, bucketName, folder.name)
      totalDeleted += folderDeleted
    }
    
  } catch (error: any) {
    console.error(`❌ Error cleaning ${bucketName} bucket:`, error.message)
  }
  
  return totalDeleted
}

/**
 * Helper function to delete all files in a folder (recursive)
 */
async function deleteFilesInFolder(supabase: any, bucketName: string, folderPath: string): Promise<number> {
  let totalDeleted = 0
  
  try {
    const { data: files, error } = await supabase.storage
      .from(bucketName)
      .list(folderPath, { limit: 1000 })
    
    if (error || !files || files.length === 0) return 0
    
    // Separate folders and files
    const folders = files.filter((f: any) => f.id === null || f.metadata === null)
    const directFiles = files.filter((f: any) => f.id !== null && f.metadata !== null)
    
    // Delete files in this folder
    if (directFiles.length > 0) {
      const filePaths = directFiles.map((f: any) => `${folderPath}/${f.name}`)
      const { error: deleteError } = await supabase.storage
        .from(bucketName)
        .remove(filePaths)
      
      if (!deleteError) {
        totalDeleted += directFiles.length
        console.log(`🗑️ ${bucketName}/${folderPath}: Deleted ${directFiles.length} files`)
      }
    }
    
    // Process subfolders
    for (const folder of folders) {
      const subDeleted = await deleteFilesInFolder(supabase, bucketName, `${folderPath}/${folder.name}`)
      totalDeleted += subDeleted
    }
    
  } catch (error: any) {
    console.warn(`⚠️ Error processing folder ${folderPath}:`, error.message)
  }
  
  return totalDeleted
}

export async function POST(request: NextRequest) {
  try {
    // Centralized environment + auth + role guard
    const guard = await assertDestructiveOpsAllowed(request, 'delete-transactions-v2')
    if (guard.blocked) return guard.response

    const supabase = await createClient()

    console.log('🚨 DELETING ALL TRANSACTION DATA + INVENTORY (V2) - Started by:', guard.userEmail)

    // Step 1: Delete storage files FIRST (before DB records are gone)
    console.log('\n📁 Step 1: Cleaning up storage files...')
    
    // Buckets that contain transaction-related files
    const bucketsToClean = ['order-documents', 'qr-codes']
    let totalStorageFilesDeleted = 0
    
    for (const bucket of bucketsToClean) {
      const deleted = await deleteAllFilesFromBucket(supabase, bucket)
      totalStorageFilesDeleted += deleted
    }
    
    console.log(`✅ Storage cleanup complete: ${totalStorageFilesDeleted} files deleted`)

    // Step 2: Call the database deletion RPC function
    console.log('\n🗄️ Step 2: Deleting database records...')
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
    
    const totalRecords = (result as any).total_records_deleted || 0

    console.log(`\n🎉 V2 COMPLETE DELETION FINISHED`)
    console.log(`📊 Total database records deleted: ${totalRecords}`)
    console.log(`📁 Storage files deleted: ${totalStorageFilesDeleted}`)
    console.log(`🔄 Order sequences RESET - Next order will be 01`)

    return NextResponse.json({
      success: true,
      deleted_count: totalRecords,
      storage_files_deleted: totalStorageFilesDeleted,
      message: `Deleted ${totalRecords} records and ${totalStorageFilesDeleted} storage files.`
    })

  } catch (error: any) {
    console.error('❌ V2 Transaction deletion error:', error)
    return NextResponse.json(
      { error: 'Failed to delete transactions', details: error.message },
      { status: 500 }
    )
  }
}
