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
        *,
        organizations (
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

    // Only HQ admins can create journeys
    const orgTypeCode = profile.organizations?.org_type_code
    const roleLevel = profile.roles?.role_level
    
    if (orgTypeCode !== 'HQ' || roleLevel > 30) {
      return NextResponse.json(
        { error: 'Insufficient permissions. Only HQ Admins can create journeys.' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const {
      name,
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
