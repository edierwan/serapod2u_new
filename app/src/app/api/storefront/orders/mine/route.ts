/**
 * GET /api/storefront/orders/mine
 * Authenticated customer: list storefront orders matching their account email.
 * Optional ?channel=outdoor|store filters sales_channel.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) {
      return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
    }

    const channel = request.nextUrl.searchParams.get('channel')
    const email = user.email.trim().toLowerCase()
    const admin: any = createAdminClient()
    let query = admin
      .from('storefront_orders')
      .select(`
        order_ref,
        status,
        sales_channel,
        total_amount,
        currency,
        shipping_tracking_no,
        shipping_courier_name,
        paid_at,
        created_at,
        storefront_order_items ( product_name, quantity )
      `)
      .ilike('customer_email', email)
      .order('created_at', { ascending: false })
      .limit(50)

    if (channel === 'outdoor' || channel === 'store') {
      query = query.eq('sales_channel', channel)
    }

    const { data, error } = await query

    if (error) {
      console.error('[storefront/orders/mine]', error)
      return NextResponse.json({ error: 'Could not load orders.' }, { status: 500 })
    }

    return NextResponse.json({
      orders: (data || []).map((order: any) => ({
        orderRef: order.order_ref,
        status: order.status,
        salesChannel: order.sales_channel || 'store',
        totalAmount: order.total_amount,
        currency: order.currency || 'MYR',
        shippingTrackingNo: order.shipping_tracking_no || null,
        shippingCourierName: order.shipping_courier_name || null,
        paidAt: order.paid_at,
        createdAt: order.created_at,
        itemCount: (order.storefront_order_items || []).reduce(
          (sum: number, row: any) => sum + (row.quantity || 0),
          0,
        ),
        preview: (order.storefront_order_items || [])
          .slice(0, 2)
          .map((row: any) => row.product_name)
          .filter(Boolean),
      })),
    })
  } catch (err) {
    console.error('[storefront/orders/mine]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
