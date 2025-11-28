import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get user profile
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ success: false, error: 'User profile not found' }, { status: 404 })
    }

    // Fetch orders with lucky draw enabled (including closed orders as QR codes may still be active)
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select(`
        id,
        order_no,
        order_type,
        status,
        has_lucky_draw,
        buyer_org_id,
        seller_org_id,
        buyer_org:organizations!orders_buyer_org_id_fkey(org_name),
        seller_org:organizations!orders_seller_org_id_fkey(org_name),
        created_at,
        order_items (
          qty,
          variant:product_variants (
            variant_name,
            image_url
          )
        )
      `)
      .eq('has_lucky_draw', true)
      .or(`buyer_org_id.eq.${profile.organization_id},seller_org_id.eq.${profile.organization_id}`)
      .order('created_at', { ascending: false })

    if (ordersError) {
      console.error('Error fetching orders:', ordersError)
      return NextResponse.json({ success: false, error: ordersError.message }, { status: 500 })
    }

    // Transform the response to flatten the organization names
    const transformedOrders = (orders || []).map(order => ({
      id: order.id,
      order_no: order.order_no,
      order_type: order.order_type,
      status: order.status,
      has_lucky_draw: order.has_lucky_draw,
      buyer_org_name: Array.isArray(order.buyer_org) && order.buyer_org.length > 0 ? order.buyer_org[0].org_name : null,
      seller_org_name: Array.isArray(order.seller_org) && order.seller_org.length > 0 ? order.seller_org[0].org_name : null,
      created_at: order.created_at,
      items: order.order_items?.map((item: any) => ({
        quantity: item.qty,
        variant_name: item.variant?.variant_name,
        image_url: item.variant?.image_url
      })) || []
    }))

    return NextResponse.json({ success: true, orders: transformedOrders })
  } catch (error) {
    console.error('Error in lucky-draw/orders:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
