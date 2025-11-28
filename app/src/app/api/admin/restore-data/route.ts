import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/admin/restore-data
 * Restore transaction data from JSON backup
 * SUPER ADMIN ONLY (role_level = 1)
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes

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

    const backupData = await request.json()

    if (!backupData || !backupData.transaction_data) {
      return NextResponse.json(
        { error: 'Invalid backup file format' },
        { status: 400 }
      )
    }

    console.log('♻️ RESTORING DATA - Started by:', user.email)
    const txData = backupData.transaction_data
    const results: any = {}

    // Helper function to restore a table
    const restoreTable = async (tableName: string, data: any[]) => {
      if (!data || data.length === 0) return 0
      
      console.log(`Restoring ${tableName} (${data.length} records)...`)
      
      // Process in chunks of 1000 to avoid payload limits
      const chunkSize = 1000
      let insertedCount = 0
      
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize)
        try {
          const { error } = await supabase
            .from(tableName as any)
            .upsert(chunk)
          
          if (error) {
            console.error(`❌ Error restoring ${tableName} chunk ${i}:`, error)
            throw new Error(`Failed to restore ${tableName}: ${error.message}`)
          }
          insertedCount += chunk.length
        } catch (err: any) {
          console.error(`❌ Exception restoring ${tableName}:`, err)
          throw err
        }
      }
      
      return insertedCount
    }

    // Restore in order of dependencies
    
    // 1. QR Batches
    if (txData.qr_batches) {
      results.qr_batches = await restoreTable('qr_batches', txData.qr_batches)
    }

    // 2. QR Master Codes
    if (txData.qr_master_codes) {
      results.qr_master_codes = await restoreTable('qr_master_codes', txData.qr_master_codes)
    }

    // 3. QR Codes
    if (txData.qr_codes) {
      results.qr_codes = await restoreTable('qr_codes', txData.qr_codes)
    }

    // 4. Orders
    if (txData.orders) {
      results.orders = await restoreTable('orders', txData.orders)
    }

    // 5. Order Items
    if (txData.order_items) {
      results.order_items = await restoreTable('order_items', txData.order_items)
    }

    // 6. Invoices
    if (txData.invoices) {
      results.invoices = await restoreTable('invoices', txData.invoices)
    }

    // 7. Payments
    if (txData.payments) {
      results.payments = await restoreTable('payments', txData.payments)
    }

    // 8. Shipments
    if (txData.shipments) {
      results.shipments = await restoreTable('shipments', txData.shipments)
    }

    // 9. Document Workflows
    if (txData.document_workflows) {
      results.document_workflows = await restoreTable('document_workflows', txData.document_workflows)
    }

    // 10. Inventory
    if (txData.inventory) {
      results.inventory = await restoreTable('inventory', txData.inventory)
    }

    // 11. Consumer QR Scans
    if (txData.consumer_qr_scans) {
      results.consumer_qr_scans = await restoreTable('consumer_qr_scans', txData.consumer_qr_scans)
    }

    // 12. Lucky Draw Entries
    if (txData.lucky_draw_entries) {
      results.lucky_draw_entries = await restoreTable('lucky_draw_entries', txData.lucky_draw_entries)
    }

    // 13. Points Transactions
    if (txData.points_transactions) {
      results.points_transactions = await restoreTable('points_transactions', txData.points_transactions)
    }

    // 14. Consumer Activations
    if (txData.consumer_activations) {
      results.consumer_activations = await restoreTable('consumer_activations', txData.consumer_activations)
    }

    // 15. Journey Order Links
    if (txData.journey_order_links) {
      results.journey_order_links = await restoreTable('journey_order_links', txData.journey_order_links)
    }

    console.log('✅ Restore complete:', results)

    return NextResponse.json({
      success: true,
      results,
      message: 'Data restored successfully'
    })

  } catch (error: any) {
    console.error('❌ Restore error:', error)
    return NextResponse.json(
      { error: 'Failed to restore data', details: error.message },
      { status: 500 }
    )
  }
}
