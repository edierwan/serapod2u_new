import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createPaymentIntent } from '@/lib/payments'

// NOTE: storefront_orders / storefront_order_items are not in the
// auto-generated database types yet. After running STOREFRONT_MIGRATION.sql
// and regenerating types (`npx supabase gen types`) the `as any` casts
// can be removed.

// ── Types ─────────────────────────────────────────────────────────

interface CheckoutBody {
  customer: {
    name: string
    email: string
    phone: string
    addressLine1: string
    addressLine2?: string
    city: string
    state: string
    postcode: string
  }
  items: {
    variantId: string
    quantity: number
  }[]
}

// ── POST /api/storefront/checkout ─────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body: CheckoutBody = await request.json()

    // Validate basics
    if (!body.customer?.name || !body.customer?.email || !body.customer?.phone) {
      return NextResponse.json({ error: 'Missing customer information' }, { status: 400 })
    }
    if (!body.items?.length) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    }

    // Cast to any: new tables not in generated types until migration runs
    const supabase: any = createAdminClient()

    // ── 1. Verify prices server-side ──────────────────────────────
    const variantIds = body.items.map((i) => i.variantId)
    const { data: variants, error: vErr } = await supabase
      .from('product_variants')
      .select('id, variant_name, suggested_retail_price, is_active, product_id, products(product_name)')
      .in('id', variantIds)
      .eq('is_active', true)

    if (vErr || !variants) {
      return NextResponse.json({ error: 'Could not verify products' }, { status: 500 })
    }

    // Map for quick lookup
    const variantMap = new Map(variants.map((v: any) => [v.id, v]))

    // Build line items with verified prices
    let orderTotal = 0
    const lineItems: {
      variant_id: string
      product_name: string
      variant_name: string
      quantity: number
      unit_price: number
      subtotal: number
    }[] = []

    for (const item of body.items) {
      const variant = variantMap.get(item.variantId) as any
      if (!variant) {
        return NextResponse.json(
          { error: `Product variant ${item.variantId} is no longer available` },
          { status: 400 },
        )
      }
      const unitPrice = variant.suggested_retail_price || 0
      if (unitPrice <= 0) {
        return NextResponse.json(
          { error: `${variant.variant_name} does not have a valid price` },
          { status: 400 },
        )
      }
      const subtotal = unitPrice * item.quantity
      orderTotal += subtotal
      lineItems.push({
        variant_id: item.variantId,
        product_name: variant.products?.product_name || 'Unknown',
        variant_name: variant.variant_name,
        quantity: item.quantity,
        unit_price: unitPrice,
        subtotal,
      })
    }

    // ── 2. Generate order reference ──────────────────────────────
    const orderRef = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`

    // ── 3. Create order ──────────────────────────────────────────
    const { data: order, error: orderErr } = await supabase
      .from('storefront_orders')
      .insert({
        order_ref: orderRef,
        status: 'pending_payment',
        customer_name: body.customer.name,
        customer_email: body.customer.email,
        customer_phone: body.customer.phone,
        shipping_address: {
          line1: body.customer.addressLine1,
          line2: body.customer.addressLine2 || '',
          city: body.customer.city,
          state: body.customer.state,
          postcode: body.customer.postcode,
        },
        total_amount: orderTotal,
        currency: 'MYR',
      })
      .select('id, order_ref')
      .single()

    if (orderErr || !order) {
      console.error('Order creation failed:', orderErr)
      return NextResponse.json({ error: 'Could not create order' }, { status: 500 })
    }

    // ── 4. Insert line items ─────────────────────────────────────
    const { error: lineErr } = await supabase.from('storefront_order_items').insert(
      lineItems.map((li) => ({
        order_id: order.id,
        variant_id: li.variant_id,
        product_name: li.product_name,
        variant_name: li.variant_name,
        quantity: li.quantity,
        unit_price: li.unit_price,
        subtotal: li.subtotal,
      })),
    )

    if (lineErr) {
      console.error('Line item creation failed:', lineErr)
      // Delete the order to be safe
      await supabase.from('storefront_orders').delete().eq('id', order.id)
      return NextResponse.json({ error: 'Could not create order items' }, { status: 500 })
    }

    // ── 5. Create payment intent via gateway adapter ─────────────
    const origin = request.nextUrl.origin
    const paymentResult = await createPaymentIntent({
      orderId: order.id,
      orderRef: order.order_ref,
      amount: orderTotal,
      currency: 'MYR',
      customerName: body.customer.name,
      customerEmail: body.customer.email,
      customerPhone: body.customer.phone,
      description: `Order ${order.order_ref}`,
      returnUrl: `${origin}/store/orders/success?ref=${order.order_ref}`,
      callbackUrl: `${origin}/api/storefront/payment/webhook`,
    })

    if (!paymentResult.success) {
      // Update order as failed
      await supabase
        .from('storefront_orders')
        .update({ status: 'payment_failed' })
        .eq('id', order.id)

      return NextResponse.json(
        { error: paymentResult.error || 'Payment gateway error' },
        { status: 502 },
      )
    }

    // Update order with payment reference
    await supabase
      .from('storefront_orders')
      .update({
        payment_provider: paymentResult.provider,
        payment_ref: paymentResult.paymentRef,
      })
      .eq('id', order.id)

    return NextResponse.json({
      orderRef: order.order_ref,
      paymentUrl: paymentResult.paymentUrl,
    })
  } catch (err: any) {
    console.error('Checkout error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
