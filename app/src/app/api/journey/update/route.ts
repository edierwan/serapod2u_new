/**
 * PATCH /api/journey/update
 * Update an existing journey configuration
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(request: NextRequest) {
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

    // Only HQ admins can update journeys
    const orgTypeCode = profile.organizations?.org_type_code
    const roleLevel = profile.roles?.role_level
    
    if (orgTypeCode !== 'HQ' || roleLevel > 30) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Journey ID is required' },
        { status: 400 }
      )
    }

    // Verify journey belongs to user's org
    const { data: existingJourney, error: fetchError } = await supabase
      .from('journey_configurations')
      .select('*')
      .eq('id', id)
      .eq('org_id', profile.organization_id)
      .single()

    if (fetchError || !existingJourney) {
      return NextResponse.json(
        { error: 'Journey not found' },
        { status: 404 }
      )
    }

    // Validate time window if being updated
    if (updates.start_at || updates.end_at) {
      const startDate = new Date(updates.start_at || existingJourney.start_at)
      const endDate = new Date(updates.end_at || existingJourney.end_at)
      if (updates.start_at && updates.end_at && endDate <= startDate) {
        return NextResponse.json(
          { error: 'End date must be after start date' },
          { status: 400 }
        )
      }
    }

    // If setting as default, unset any existing default for this org
    if (updates.is_default === true) {
      await supabase
        .from('journey_configurations')
        .update({ is_default: false })
        .eq('org_id', profile.organization_id)
        .eq('is_default', true)
        .neq('id', id)
    }

    // Build update object with only allowed fields
    const allowedFields = [
      'name',
      'is_active',
      'is_default',
      'points_enabled',
      'lucky_draw_enabled',
      'redemption_enabled',
      'require_staff_otp_for_points',
      'require_customer_otp_for_lucky_draw',
      'require_customer_otp_for_redemption',
      'start_at',
      'end_at'
    ]

    const updateData: any = {}
    for (const field of allowedFields) {
      if (updates.hasOwnProperty(field)) {
        updateData[field] = updates[field]
      }
    }

    // Update the journey
    const { data: journey, error: updateError } = await supabase
      .from('journey_configurations')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', profile.organization_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating journey:', updateError)
      return NextResponse.json(
        { error: 'Failed to update journey' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      journey
    })
  } catch (error) {
    console.error('Error in journey update:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
