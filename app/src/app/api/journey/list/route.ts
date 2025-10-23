/**
 * GET /api/journey/list
 * List all journey configurations for the user's organization
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
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

    // Get user profile to find organization_id
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 404 }
      )
    }

    // Fetch all journey configurations for this org
    const { data: journeys, error: journeysError } = await supabase
      .from('journey_configurations')
      .select('*')
      .eq('org_id', profile.organization_id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })

    if (journeysError) {
      console.error('Error fetching journeys:', journeysError)
      return NextResponse.json(
        { error: 'Failed to fetch journeys' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      journeys: journeys || []
    })
  } catch (error) {
    console.error('Error in journey list:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
