import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/journey/orders
 * Fetches orders eligible for journey builder
 * (orders with has_redeem=true OR has_lucky_draw=true)
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()

        // Get current user
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized' },
                { status: 401 }
            )
        }

        // Get user profile to find organization_id
        const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        if (profileError || !profile) {
            console.error('Profile error:', profileError)
            return NextResponse.json(
                { success: false, error: 'User profile not found' },
                { status: 404 }
            )
        }

        const companyId = profile.organization_id

        // Fetch orders with engagement features
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select(`
        id,
        order_no,
        order_type,
        status,
        has_redeem,
        has_lucky_draw,
        buyer_org_id,
        seller_org_id,
        created_at,
        buyer_org:organizations!orders_buyer_org_id_fkey(org_name),
        seller_org:organizations!orders_seller_org_id_fkey(org_name)
      `)
            .eq('company_id', companyId)
            .or('has_redeem.eq.true,has_lucky_draw.eq.true')
            .order('created_at', { ascending: false })

        if (ordersError) {
            console.error('Error fetching orders:', ordersError)
            return NextResponse.json(
                { success: false, error: 'Failed to fetch orders' },
                { status: 500 }
            )
        }

        // Handle null or undefined orders
        if (!orders) {
            console.log('No orders found for company:', companyId)
            return NextResponse.json({
                success: true,
                orders: []
            })
        }

        // For each order, get redeem gifts count and lucky draw campaigns count
        const ordersWithCounts = await Promise.all(
            orders.map(async (order) => {
                // Get redeem gifts count
                let redeemGiftsCount = 0
                if (order.has_redeem) {
                    const { count } = await supabase
                        .from('redeem_gifts')
                        .select('id', { count: 'exact', head: true })
                        .eq('order_id', order.id)
                        .eq('is_active', true)

                    redeemGiftsCount = count || 0
                }

                // Get lucky draw campaigns count
                let luckyDrawCampaignsCount = 0
                if (order.has_lucky_draw) {
                    const { count } = await supabase
                        .from('lucky_draw_order_links')
                        .select(`
              lucky_draw_campaign_id,
              lucky_draw_campaigns!inner(id, status)
            `, { count: 'exact', head: true })
                        .eq('order_id', order.id)

                    luckyDrawCampaignsCount = count || 0
                }

                // Check if journey already exists for this order
                const { data: journeyLink } = await supabase
                    .from('journey_order_links')
                    .select(`
            id,
            journey_config_id,
            journey_configurations(
              id,
              config_name,
              is_active
            )
          `)
                    .eq('order_id', order.id)
                    .maybeSingle()

                const buyerOrgName = Array.isArray(order.buyer_org) && order.buyer_org.length > 0
                    ? order.buyer_org[0].org_name
                    : null
                const sellerOrgName = Array.isArray(order.seller_org) && order.seller_org.length > 0
                    ? order.seller_org[0].org_name
                    : null
                const journeyConfig = journeyLink?.journey_configurations && typeof journeyLink.journey_configurations === 'object'
                    ? journeyLink.journey_configurations as any
                    : null

                return {
                    id: order.id,
                    order_no: order.order_no,
                    order_type: order.order_type,
                    status: order.status,
                    has_redeem: order.has_redeem,
                    has_lucky_draw: order.has_lucky_draw,
                    redeem_gifts_count: redeemGiftsCount,
                    lucky_draw_campaigns_count: luckyDrawCampaignsCount,
                    buyer_org_name: buyerOrgName,
                    seller_org_name: sellerOrgName,
                    existing_journey_id: journeyConfig?.id || null,
                    existing_journey_name: journeyConfig?.config_name || null,
                    created_at: order.created_at
                }
            })
        )

        return NextResponse.json({
            success: true,
            orders: ordersWithCounts
        })

    } catch (error) {
        console.error('Error in GET /api/journey/orders:', error)
        return NextResponse.json(
            { success: false, error: 'Internal server error' },
            { status: 500 }
        )
    }
}
