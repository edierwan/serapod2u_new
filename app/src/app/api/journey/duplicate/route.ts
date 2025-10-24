/**
 * POST /api/journey/duplicate
 * Duplicate an existing journey configuration
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()

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
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 404 }
      )
    }

    // Only HQ admins can duplicate journeys
    const orgTypeCode = profile.organizations?.org_type_code
    const roleLevel = profile.roles?.role_level
    
    if (orgTypeCode !== 'HQ' || roleLevel > 30) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Journey ID is required' },
        { status: 400 }
      )
    }

    // Get the journey to duplicate
    const { data: sourceJourney, error: fetchError } = await supabase
      .from('journey_configurations')
      .select('*')
      .eq('id', id)
      .eq('org_id', profile.organization_id)
      .single()

    if (fetchError || !sourceJourney) {
      return NextResponse.json(
        { error: 'Journey not found' },
        { status: 404 }
      )
    }

    // Create a copy with a new name
    const copyName = `${sourceJourney.name} (Copy)`

    const { data: newJourney, error: createError } = await supabase
      .from('journey_configurations')
      .insert({
        org_id: profile.organization_id,
        name: copyName,
        is_active: false, // Start inactive
        is_default: false, // Never duplicate as default
        points_enabled: sourceJourney.points_enabled,
        lucky_draw_enabled: sourceJourney.lucky_draw_enabled,
        redemption_enabled: sourceJourney.redemption_enabled,
        require_staff_otp_for_points: sourceJourney.require_staff_otp_for_points,
        require_customer_otp_for_lucky_draw:
          sourceJourney.require_customer_otp_for_lucky_draw,
        require_customer_otp_for_redemption:
          sourceJourney.require_customer_otp_for_redemption,
        start_at: sourceJourney.start_at,
        end_at: sourceJourney.end_at
      })
      .select()
      .single()

    if (createError) {
      console.error('Error duplicating journey:', createError)
      return NextResponse.json(
        { error: 'Failed to duplicate journey' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      journey: newJourney
    })
  } catch (error) {
    console.error('Error in journey duplicate:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
