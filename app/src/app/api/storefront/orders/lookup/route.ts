import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { easyParcelTrackAwb, isEasyParcelConfigured } from '@/lib/shipping/easyparcel'

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function normalizeRef(value: unknown) {
  return String(value || '').trim().toUpperCase()
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const orderRef = normalizeRef(body?.orderRef || body?.ref)
    const email = normalizeEmail(body?.email)

    if (!orderRef || !email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Order reference and email are required.' },
        { status: 400 },
      )
    }

    const admin: any = createAdminClient()
    const { data: order, error } = await admin
      .from('storefront_orders')
      .select(`
        id,
        order_ref,
        status,
        total_amount,
        currency,
        customer_name,
        customer_email,
        customer_phone,
        shipping_address,
        shipping_amount,
        shipping_courier_name,
        shipping_tracking_no,
        payment_provider,
        paid_at,
        created_at,
        storefront_order_items (
          id,
          product_name,
          variant_name,
          quantity,
          unit_price,
          subtotal
        )
      `)
      .eq('order_ref', orderRef)
      .ilike('customer_email', email)
      .maybeSingle()

    if (error) {
      console.error('[storefront/orders/lookup]', error)
      return NextResponse.json({ error: 'Could not look up order.' }, { status: 500 })
    }

    if (!order) {
      return NextResponse.json(
        { error: 'No order found for that reference and email.' },
        { status: 404 },
      )
    }

    let courierEvents: Array<{ status: string; date: string | null; location: string | null; remark: string | null }> = []
    let courierLatestStatus: string | null = null
    if (order.shipping_tracking_no && isEasyParcelConfigured()) {
      const tracked = await easyParcelTrackAwb(order.shipping_tracking_no)
      if (tracked.ok) {
        courierEvents = tracked.events
        courierLatestStatus = tracked.latestStatus
      }
    }

    return NextResponse.json({
      order: {
        orderRef: order.order_ref,
        status: order.status,
        totalAmount: order.total_amount,
        currency: order.currency || 'MYR',
        customerName: order.customer_name,
        customerEmail: order.customer_email,
        customerPhone: order.customer_phone,
        shippingAddress: order.shipping_address,
        shippingAmount: order.shipping_amount ?? 0,
        shippingCourierName: order.shipping_courier_name || null,
        shippingTrackingNo: order.shipping_tracking_no || null,
        paymentProvider: order.payment_provider,
        paidAt: order.paid_at,
        createdAt: order.created_at,
        courierLatestStatus,
        courierEvents,
        items: (order.storefront_order_items || []).map((item: any) => ({
          productName: item.product_name,
          variantName: item.variant_name,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          subtotal: item.subtotal,
        })),
      },
    })
  } catch (err) {
    console.error('[storefront/orders/lookup]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
