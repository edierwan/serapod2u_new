import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { resolveOrderProductCategories } from '@/lib/journey/product-experience'

/**
 * GET /api/journey/order-experience?order_id=...
 *
 * Server-trusted detection of the mobile experience(s) for an order, derived
 * from real FK relationships (orders → order_items → products → categories).
 * Scoped to the requesting user's organization so Journey Builder preview can
 * never expose another org's order/product data.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const orderId = request.nextUrl.searchParams.get('order_id')
        if (!orderId) {
            return NextResponse.json({ success: false, error: 'order_id is required' }, { status: 400 })
        }

        const supabase = await createClient()

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
        }

        const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        if (profileError || !profile) {
            return NextResponse.json({ success: false, error: 'User profile not found' }, { status: 404 })
        }

        // Verify the order belongs to the user's organization before resolving.
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, company_id')
            .eq('id', orderId)
            .maybeSingle()

        if (orderError || !order) {
            return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404 })
        }

        if (order.company_id !== profile.organization_id) {
            return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
        }

        const resolution = await resolveOrderProductCategories(supabase, orderId)

        return NextResponse.json({ success: true, experience: resolution })
    } catch (error) {
        console.error('Error in GET /api/journey/order-experience:', error)
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }
}
