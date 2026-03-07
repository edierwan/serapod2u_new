import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/orders/from-ellbow
 *
 * Accepts an order from the Ellbow cat-food website and creates
 * a storefront_order + storefront_order_items in Serapod2u.
 *
 * Auth: header  X-ELLBOW-ORDER-KEY  must match env  ELLBOW_ORDER_KEY
 * Idempotency: optional header  X-Idempotency-Key  — if a storefront_order
 *   with that idempotency_key already exists, the existing order is returned.
 *
 * Body:
 * {
 *   customer: { email, name, phone?, address_line1, address_line2?, city, state, postcode },
 *   items: [{ serapod_variant_id, qty }],
 *   shipping: { address_line1, address_line2, city, state, postcode },
 *   idempotency_key?: string
 * }
 *
 * Response:
 * { order_id, order_ref, status, total_amount }
 */

// Simple random ref generator
function generateOrderRef(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const seg1 = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    const seg2 = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    return `ELB-${seg1}-${seg2}`
}

export async function POST(request: NextRequest) {
    // ── Auth ────────────────────────────────────────────────────────
    const orderKey = request.headers.get('x-ellbow-order-key')
    const expectedKey = process.env.ELLBOW_ORDER_KEY

    if (!expectedKey) {
        return NextResponse.json(
            { error: 'Server misconfiguration: ELLBOW_ORDER_KEY not set' },
            { status: 500 },
        )
    }

    if (!orderKey || orderKey !== expectedKey) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase: any = createAdminClient()

    try {
        const body = await request.json()

        // ── Validate input ────────────────────────────────────────────
        const { customer, items, shipping } = body

        if (!customer?.email || !customer?.name) {
            return NextResponse.json({ error: 'customer.email and customer.name are required' }, { status: 400 })
        }

        if (!items?.length || !Array.isArray(items)) {
            return NextResponse.json({ error: 'items array is required and must not be empty' }, { status: 400 })
        }

        for (const item of items) {
            if (!item.serapod_variant_id || !item.qty || item.qty < 1) {
                return NextResponse.json(
                    { error: 'Each item must have serapod_variant_id and qty >= 1' },
                    { status: 400 },
                )
            }
        }

        // ── Idempotency check ─────────────────────────────────────────
        const idempotencyKey = request.headers.get('x-idempotency-key') || body.idempotency_key

        if (idempotencyKey) {
            // Check if we already processed this order
            const { data: existing } = await supabase
                .from('storefront_orders')
                .select('id, order_ref, status, total_amount')
                .eq('payment_ref', `idempotent:${idempotencyKey}`)
                .maybeSingle()

            if (existing) {
                return NextResponse.json({
                    order_id: existing.id,
                    order_ref: existing.order_ref,
                    status: existing.status,
                    total_amount: Number(existing.total_amount),
                    idempotent_hit: true,
                })
            }
        }

        // ── Verify variants & compute totals ──────────────────────────
        const variantIds = items.map((i: any) => i.serapod_variant_id)

        const { data: variants, error: vErr } = await supabase
            .from('product_variants')
            .select('id, variant_name, suggested_retail_price, is_active, product_id, products(product_name)')
            .in('id', variantIds)
            .eq('is_active', true)

        if (vErr || !variants) {
            return NextResponse.json({ error: 'Could not verify variants' }, { status: 500 })
        }

        const variantMap = new Map(variants.map((v: any) => [v.id, v]))

        let orderTotal = 0
        const lineItems: any[] = []

        for (const item of items) {
            const variant = variantMap.get(item.serapod_variant_id) as any
            if (!variant) {
                return NextResponse.json(
                    { error: `Variant ${item.serapod_variant_id} is unavailable or inactive` },
                    { status: 400 },
                )
            }

            const unitPrice = variant.suggested_retail_price || 0
            const subtotal = unitPrice * item.qty
            orderTotal += subtotal

            lineItems.push({
                variant_id: variant.id,
                product_name: variant.products?.product_name || 'Unknown Product',
                variant_name: variant.variant_name,
                quantity: item.qty,
                unit_price: unitPrice,
                subtotal,
            })
        }

        // ── Create order ──────────────────────────────────────────────
        const shippingAddress = shipping
            ? {
                line1: shipping.address_line1 || customer.address_line1 || '',
                line2: shipping.address_line2 || customer.address_line2 || '',
                city: shipping.city || customer.city || '',
                state: shipping.state || customer.state || '',
                postcode: shipping.postcode || customer.postcode || '',
            }
            : {
                line1: customer.address_line1 || '',
                line2: customer.address_line2 || '',
                city: customer.city || '',
                state: customer.state || '',
                postcode: customer.postcode || '',
            }

        const orderRef = generateOrderRef()

        const { data: order, error: oErr } = await supabase
            .from('storefront_orders')
            .insert({
                order_ref: orderRef,
                status: 'pending_payment',
                customer_name: customer.name,
                customer_email: customer.email,
                customer_phone: customer.phone || null,
                shipping_address: shippingAddress,
                total_amount: orderTotal,
                currency: 'MYR',
                payment_provider: 'ellbow', // identify source
                payment_ref: idempotencyKey ? `idempotent:${idempotencyKey}` : null,
            })
            .select('id, order_ref, status, total_amount')
            .single()

        if (oErr || !order) {
            console.error('[from-ellbow] order insert error:', oErr)
            return NextResponse.json(
                { error: 'Failed to create order', detail: oErr?.message },
                { status: 500 },
            )
        }

        // ── Insert line items ─────────────────────────────────────────
        const orderItemRows = lineItems.map((li) => ({
            order_id: order.id,
            ...li,
        }))

        const { error: liErr } = await supabase
            .from('storefront_order_items')
            .insert(orderItemRows)

        if (liErr) {
            console.error('[from-ellbow] line items insert error:', liErr)
            // Order was created but items failed — mark as failed
            await supabase
                .from('storefront_orders')
                .update({ status: 'payment_failed' })
                .eq('id', order.id)

            return NextResponse.json(
                { error: 'Order created but line items failed', order_id: order.id },
                { status: 500 },
            )
        }

        // ── Return success ────────────────────────────────────────────
        return NextResponse.json({
            order_id: order.id,
            order_ref: order.order_ref,
            status: order.status,
            total_amount: Number(order.total_amount),
        })
    } catch (err: any) {
        console.error('[from-ellbow] Unexpected error:', err)
        return NextResponse.json(
            { error: 'Internal server error', detail: err?.message },
            { status: 500 },
        )
    }
}
