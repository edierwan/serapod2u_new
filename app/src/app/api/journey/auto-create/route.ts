/**
 * POST /api/journey/auto-create
 * Automatically create a journey when warehouse receives an order
 * This is only executed if auto_journey_creation is enabled in organization settings
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const adminClient = createAdminClient() // Use admin client to bypass RLS

    // Get current user
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('[Auto-Journey] Auth error:', authError)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { order_id } = body

    console.log('[Auto-Journey] Starting auto-create for order_id:', order_id)

    if (!order_id) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    // Get order details with organization (use admin client to ensure we can read all orders)
    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select(`
        id,
        order_no,
        order_type,
        has_redeem,
        has_lucky_draw,
        company_id,
        status,
        seller_org_id,
        buyer_org_id
      `)
      .eq('id', order_id)
      .single()

    if (orderError || !order) {
      console.error('[Auto-Journey] Order not found:', orderError)
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    console.log('[Auto-Journey] Order found:', {
      order_no: order.order_no,
      order_type: order.order_type,
      seller_org_id: order.seller_org_id,
      buyer_org_id: order.buyer_org_id,
      has_redeem: order.has_redeem,
      has_lucky_draw: order.has_lucky_draw
    })

    // Only H2M orders can have journeys created (Issue 1 requirement)
    if (order.order_type !== 'H2M') {
      console.log('[Auto-Journey] Skipped: Not an H2M order, order_type:', order.order_type)
      return NextResponse.json({
        success: false,
        skipped: true,
        reason: 'Only HM orders can have journeys - DH orders use HM QR codes'
      })
    }

    // Get the seller organization (HQ) settings to check if auto_journey_creation is enabled
    // For H2M orders, seller_org_id is the HQ
    const { data: orgData, error: orgError } = await adminClient
      .from('organizations')
      .select('id, org_name, settings')
      .eq('id', order.seller_org_id)
      .single()

    if (orgError || !orgData) {
      console.error('[Auto-Journey] Organization not found:', orgError)
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      )
    }

    console.log('[Auto-Journey] Organization found:', orgData.org_name, 'Raw settings:', typeof orgData.settings)

    // Parse settings
    let settings: Record<string, any> = {}
    if (typeof orgData.settings === 'string') {
      try {
        settings = JSON.parse(orgData.settings)
      } catch (e) {
        console.error('[Auto-Journey] Failed to parse settings string:', e)
        settings = {}
      }
    } else if (typeof orgData.settings === 'object' && orgData.settings !== null) {
      settings = orgData.settings as Record<string, any>
    }

    console.log('[Auto-Journey] Parsed settings auto_journey_creation:', settings.auto_journey_creation)

    // Check if auto journey creation is enabled
    if (!settings.auto_journey_creation) {
      console.log('[Auto-Journey] Skipped: auto_journey_creation is not enabled')
      return NextResponse.json({
        success: false,
        skipped: true,
        reason: 'Auto journey creation is not enabled'
      })
    }

    // Check if order has engagement features
    if (!order.has_redeem && !order.has_lucky_draw) {
      console.log('[Auto-Journey] Skipped: No engagement features enabled')
      return NextResponse.json({
        success: false,
        skipped: true,
        reason: 'Order does not have redemption or lucky draw features enabled'
      })
    }

    // Check if order already has a journey
    const { data: existingLink } = await adminClient
      .from('journey_order_links')
      .select('id')
      .eq('order_id', order_id)
      .maybeSingle()

    if (existingLink) {
      console.log('[Auto-Journey] Skipped: Order already has a journey')
      return NextResponse.json({
        success: false,
        skipped: true,
        reason: 'Order already has a journey configured'
      })
    }

    // Create the journey with default settings
    const journeyName = `Journey for ${order.order_no}`
    const startDate = new Date().toISOString().split('T')[0]

    console.log('[Auto-Journey] Creating journey:', {
      org_id: order.seller_org_id,
      name: journeyName,
      created_by: user.id
    })

    const { data: journey, error: createError } = await adminClient
      .from('journey_configurations')
      .insert({
        org_id: order.seller_org_id,
        name: journeyName,
        is_active: true,
        is_default: false,
        points_enabled: true,
        lucky_draw_enabled: order.has_lucky_draw || false,
        redemption_enabled: order.has_redeem || false,
        require_staff_otp_for_points: false,
        require_customer_otp_for_lucky_draw: false,
        require_customer_otp_for_redemption: false,
        require_security_code: false,
        enable_scratch_card_game: false,
        start_at: startDate,
        end_at: null, // Infinite by default
        welcome_title: 'Welcome!',
        welcome_message: 'Thank you for scanning our QR code. Enjoy exclusive rewards and benefits!',
        thank_you_message: 'Thank you for your participation!',
        primary_color: '#F06105',
        button_color: '#F06105',
        created_by: user.id
      })
      .select()
      .single()

    if (createError) {
      console.error('[Auto-Journey] Error creating journey:', createError)
      return NextResponse.json(
        { error: 'Failed to create journey: ' + createError.message },
        { status: 500 }
      )
    }

    console.log('[Auto-Journey] Journey created successfully, id:', journey.id)

    // Link journey to order
    const { error: linkError } = await adminClient
      .from('journey_order_links')
      .insert({
        journey_config_id: journey.id,
        order_id: order_id,
        created_by: user.id
      })

    if (linkError) {
      console.error('[Auto-Journey] Error linking journey to order:', linkError)
      // Rollback: delete the journey
      await adminClient
        .from('journey_configurations')
        .delete()
        .eq('id', journey.id)

      return NextResponse.json(
        { error: 'Failed to link journey to order: ' + linkError.message },
        { status: 500 }
      )
    }

    console.log(`[Auto-Journey] Successfully auto-created journey "${journeyName}" for order ${order.order_no}`)

    return NextResponse.json({
      success: true,
      journey,
      message: `Journey "${journeyName}" has been automatically created`
    })
  } catch (error) {
    console.error('[Auto-Journey] Unhandled error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
