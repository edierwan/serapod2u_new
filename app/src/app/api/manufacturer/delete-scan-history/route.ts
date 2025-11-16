import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * DELETE /api/manufacturer/delete-scan-history
 * 
 * Deletes scan history records for a specific order.
 * This only deletes the history tracking records, not the actual master cases or QR codes.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Authenticate user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { order_id } = body

    if (!order_id) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    // Get user's organization from user metadata
    const organizationId = user.user_metadata?.organization_id

    if (!organizationId) {
      return NextResponse.json(
        { error: 'User organization not found' },
        { status: 403 }
      )
    }

    // Verify the order belongs to this manufacturer
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, seller_org_id')
      .eq('id', order_id)
      .single()

    if (orderError || !order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    if (order.seller_org_id !== organizationId) {
      return NextResponse.json(
        { error: 'Unauthorized to delete history for this order' },
        { status: 403 }
      )
    }

    // Get batch ID for this order
    const { data: batch } = await supabase
      .from('qr_batches')
      .select('id')
      .eq('order_id', order_id)
      .single()

    if (!batch) {
      return NextResponse.json(
        { error: 'No batch found for this order' },
        { status: 404 }
      )
    }

    // Delete master codes history records for this batch
    // Note: This only deletes the master_codes records, not the QR codes themselves
    const { error: deleteError, count } = await supabase
      .from('qr_master_codes')
      .delete()
      .eq('batch_id', batch.id)

    if (deleteError) {
      console.error('Error deleting scan history:', deleteError)
      throw deleteError
    }

    console.log(`✅ Deleted ${count || 0} scan history records for order ${order_id}`)

    return NextResponse.json({
      success: true,
      deleted_count: count || 0,
      message: 'Scan history deleted successfully'
    })

  } catch (error: any) {
    console.error('Error in delete-scan-history API:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}
