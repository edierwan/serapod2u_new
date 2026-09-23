import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createPaymentIntent } from '@/lib/payments'
import { publicOriginFromRequest } from '@/lib/http/public-origin'

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function normalizeRef(value: unknown) {
  return String(value || '').trim().toUpperCase()
}

/** POST — open a new payment page for an order that is still waiting for payment. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const orderRef = normalizeRef(body?.orderRef || body?.ref)
    let email = normalizeEmail(body?.email)
    if (!email) {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      email = normalizeEmail(user?.email)
    }
    if (!orderRef || !email.includes('@')) {
      return NextResponse.json({ error: 'Sign in to continue this payment.' }, { status: 400 })
    }

    const admin: any = createAdminClient()
    const { data: order, error } = await admin
      .from('storefront_orders')
      .select('id, order_ref, status, sales_channel, customer_name, customer_email, customer_phone, total_amount, currency, payment_provider')
      .eq('order_ref', orderRef)
      .ilike('customer_email', email)
      .maybeSingle()

    if (error) {
      console.error('[storefront/resume-payment]', error)
      return NextResponse.json({ error: 'Could not open payment.' }, { status: 500 })
    }
    if (!order) {
      return NextResponse.json({ error: 'No order found for this account.' }, { status: 404 })
    }
    if (String(order.status) !== 'pending_payment') {
      return NextResponse.json({ error: 'This order is not waiting for payment.' }, { status: 400 })
    }

    const amount = Number(order.total_amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'This order does not have an amount to pay.' }, { status: 400 })
    }

    const origin = publicOriginFromRequest(request)
    const outdoor = order.sales_channel === 'outdoor'
    const paymentResult = await createPaymentIntent(
      {
        orderId: order.id,
        orderRef: order.order_ref,
        amount,
        currency: order.currency || 'MYR',
        customerName: order.customer_name || '',
        customerEmail: order.customer_email,
        customerPhone: order.customer_phone || '',
        description: `Order ${order.order_ref}`,
        returnUrl: outdoor
          ? `${origin}/outdoor/orders/success?ref=${order.order_ref}`
          : `${origin}/store/orders/success?ref=${order.order_ref}`,
        cancelUrl: outdoor
          ? `${origin}/outdoor/account?tab=orders&pending=${encodeURIComponent(order.order_ref)}`
          : undefined,
        callbackUrl: `${origin}/api/storefront/payment/webhook`,
      },
      order.payment_provider,
    )

    if (!paymentResult.success) {
      return NextResponse.json({ error: paymentResult.error || 'Payment gateway error' }, { status: 502 })
    }

    await admin.from('storefront_orders').update({
      payment_provider: paymentResult.provider,
      payment_ref: paymentResult.paymentRef,
    }).eq('id', order.id)

    return NextResponse.json({
      orderRef: order.order_ref,
      paymentUrl: paymentResult.paymentUrl || null,
    })
  } catch (err) {
    console.error('[storefront/resume-payment]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
