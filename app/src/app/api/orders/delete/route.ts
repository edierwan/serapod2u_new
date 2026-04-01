import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { assertDestructiveOpsAllowed } from '@/lib/server/destructive-ops-guard'

export async function POST(request: NextRequest) {
  try {
    // Centralized environment + auth + role guard
    const guard = await assertDestructiveOpsAllowed(request, 'hard-delete-order')
    if (guard.blocked) return guard.response

    const adminSupabase = createAdminClient()

    const body = await request.json()
    const { orderId } = body

    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
    }

    // Get order details before deletion (capture info for notification)
    const { data: order } = await adminSupabase
      .from('orders')
      .select('order_no, display_doc_no, company_id, buyer_org_id, seller_org_id, notes, status')
      .eq('id', orderId)
      .single()

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const displayOrderNo = order.display_doc_no || order.order_no
    console.log(`🗑️ Super Admin ${guard.userEmail} deleting order ${displayOrderNo} (${orderId})`)

    // Queue notification BEFORE deletion (since order will be hard-deleted)
    try {
      // Parse customer name from notes
      const notes = order.notes || ''
      const customerMatch = notes.match(/Customer:\s*([^,]+)/)
      const customerName = customerMatch?.[1]?.trim() || 'Unknown'

      const { data: deleterProfile } = await adminSupabase
        .from('users')
        .select('full_name')
        .eq('id', guard.userId)
        .single()

      const payload = {
        order_no: displayOrderNo,
        order_date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        customer_name: customerName,
        status: order.status || 'deleted',
        deleted_by: deleterProfile?.full_name || guard.userEmail || 'Super Admin',
        deleted_at: new Date().toLocaleString('en-GB'),
        order_url: 'https://app.serapod2u.com/orders'
      }

      // Queue for each channel
      for (const channel of ['whatsapp', 'sms', 'email']) {
        await adminSupabase.from('notifications_outbox').insert({
          org_id: order.company_id,
          event_code: 'order_deleted',
          channel,
          payload_json: payload,
          priority: 'normal',
          status: 'queued',
          retry_count: 0,
          max_retries: 3,
          created_at: new Date().toISOString()
        })
      }
    } catch (notifErr) {
      console.warn('⚠️ Failed to queue delete notification (non-blocking):', notifErr)
    }

    // Delete Excel files from storage first
    const { data: excelFiles } = await adminSupabase.storage
      .from('order-excel')
      .list(`${orderId}/`)

    if (excelFiles && excelFiles.length > 0) {
      const filePaths = excelFiles.map(file => `${orderId}/${file.name}`)
      await adminSupabase.storage.from('order-excel').remove(filePaths)
      console.log(`🗑️ Deleted ${excelFiles.length} Excel files from storage`)
    }

    // Use RPC function for fast, reliable hard delete that bypasses RLS
    console.log('🗑️ Calling hard_delete_order RPC...')
    const { data: result, error: rpcError } = await adminSupabase
      .rpc('hard_delete_order', { p_order_id: orderId })

    if (rpcError) {
      console.error('❌ RPC error:', rpcError)
      throw new Error(rpcError.message || 'Failed to delete order via RPC')
    }

    if (!result?.success) {
      throw new Error(result?.error || 'Failed to delete order')
    }

    console.log('🎉 Order deleted successfully:', result)

    // Fire-and-forget: trigger notification outbox worker
    const baseUrl = request.nextUrl.origin
    fetch(`${baseUrl}/api/cron/notification-outbox-worker`).catch(() => { })

    return NextResponse.json({
      success: true,
      message: `Order ${displayOrderNo} deleted successfully`,
      order_no: displayOrderNo,
      deleted: result.deleted
    })
  } catch (error: any) {
    console.error('❌ Error deleting order:', error)
    return NextResponse.json(
      {
        error: error.message || 'Failed to delete order',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Allow up to 5 minutes for large deletions
