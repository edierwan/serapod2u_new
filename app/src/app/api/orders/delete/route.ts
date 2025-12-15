import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const adminSupabase = createAdminClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is Super Admin (only super admins can delete orders)
    const { data: profile } = await supabase
      .from('users')
      .select('role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    const isSuperAdmin = profile && (profile as any).roles && (profile as any).roles.role_level === 1

    if (!isSuperAdmin) {
      return NextResponse.json({ 
        error: 'Permission denied. Only Super Admins can delete orders.' 
      }, { status: 403 })
    }

    const body = await request.json()
    const { orderId } = body

    if (!orderId) {
      return NextResponse.json({ error: 'Order ID is required' }, { status: 400 })
    }

    // Get order details before deletion
    const { data: order } = await adminSupabase
      .from('orders')
      .select('order_no')
      .eq('id', orderId)
      .single()

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    console.log(`🗑️ Super Admin ${user.email} deleting order ${order.order_no} (${orderId})`)

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

    return NextResponse.json({ 
      success: true, 
      message: `Order ${order.order_no} deleted successfully`,
      order_no: order.order_no,
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
