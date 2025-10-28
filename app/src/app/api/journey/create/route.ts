/**
 * POST /api/journey/create
 * Create a new journey configuration
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Get current user
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile with relationships
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select(`
        id,
        organization_id,
        role_code,
        organizations!fk_users_organization (
          id,
          org_type_code
        ),
        roles (
          role_level
        )
      `)
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      console.error('Profile error:', profileError)
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 404 }
      )
    }

    // Extract organization and role info from arrays
    const organizations = Array.isArray(profile.organizations) ? profile.organizations : []
    const roles = Array.isArray(profile.roles) ? profile.roles : []

    const orgTypeCode = organizations.length > 0 ? organizations[0].org_type_code : null
    const roleLevel = roles.length > 0 ? roles[0].role_level : null

    // Check if user has admin permissions (role_level <= 30)
    // Journeys can be created by any organization (HQ, DIST, MFR) for their orders
    if (!roleLevel || roleLevel > 30) {
      return NextResponse.json(
        { error: 'Insufficient permissions. Admin access required to create journeys.' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      name,
      order_id,
      is_default = false,
      points_enabled = false,
      lucky_draw_enabled = false,
      redemption_enabled = false,
      require_staff_otp_for_points = false,
      require_customer_otp_for_lucky_draw = false,
      require_customer_otp_for_redemption = false,
      start_at = null,
      end_at = null
    } = body

    // Validate required fields
    if (!name || name.trim() === '') {
      return NextResponse.json(
        { error: 'Journey name is required' },
        { status: 400 }
      )
    }

    if (!order_id) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    // Validate order exists and has engagement features
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, order_no, has_redeem, has_lucky_draw, company_id, status')
      .eq('id', order_id)
      .single()

    if (orderError || !order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Verify order belongs to user's organization
    if (order.company_id !== profile.organization_id) {
      return NextResponse.json(
        { error: 'You can only create journeys for orders from your organization' },
        { status: 403 }
      )
    }

    if (!order.has_redeem && !order.has_lucky_draw) {
      return NextResponse.json(
        { error: 'Order must have redeem or lucky draw features enabled' },
        { status: 400 }
      )
    }

    // Note: Journey can be created for orders in any status (draft, submitted, approved, closed)
    // Even closed orders can have consumer engagement journeys

    // Check if order already has a journey
    const { data: existingLink } = await supabase
      .from('journey_order_links')
      .select('id')
      .eq('order_id', order_id)
      .maybeSingle()

    if (existingLink) {
      return NextResponse.json(
        { error: 'This order already has a journey configured' },
        { status: 400 }
      )
    }

    // Validate time window
    if (start_at && end_at) {
      const startDate = new Date(start_at)
      const endDate = new Date(end_at)
      if (endDate <= startDate) {
        return NextResponse.json(
          { error: 'End date must be after start date' },
          { status: 400 }
        )
      }
    }

    // If setting as default, unset any existing default for this org
    if (is_default) {
      await supabase
        .from('journey_configurations')
        .update({ is_default: false })
        .eq('org_id', profile.organization_id)
        .eq('is_default', true)
    }

    // Create the journey
    const { data: journey, error: createError } = await supabase
      .from('journey_configurations')
      .insert({
        org_id: profile.organization_id,
        name: name.trim(),
        is_active: true,
        is_default,
        points_enabled,
        lucky_draw_enabled,
        redemption_enabled,
        require_staff_otp_for_points,
        require_customer_otp_for_lucky_draw,
        require_customer_otp_for_redemption,
        start_at,
        end_at
      })
      .select()
      .single()

    if (createError) {
      console.error('Error creating journey:', createError)
      return NextResponse.json(
        { error: 'Failed to create journey' },
        { status: 500 }
      )
    }

    // Link journey to order
    const { error: linkError } = await supabase
      .from('journey_order_links')
      .insert({
        journey_config_id: journey.id,
        order_id: order_id,
        created_by: user.id
      })

    if (linkError) {
      console.error('Error linking journey to order:', linkError)
      // Rollback: delete the journey
      await supabase
        .from('journey_configurations')
        .delete()
        .eq('id', journey.id)

      return NextResponse.json(
        { error: 'Failed to link journey to order' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      journey
    })
  } catch (error) {
    console.error('Error in journey create:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
