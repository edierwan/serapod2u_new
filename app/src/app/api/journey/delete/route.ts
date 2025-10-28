/**
 * DELETE /api/journey/delete
 * Delete a journey configuration
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest) {
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
    if (!roleLevel || roleLevel > 30) {
      return NextResponse.json(
        { error: 'Insufficient permissions. Admin access required.' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

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

    // Check if journey is linked to any orders
    const { data: linkedOrders, error: linkError } = await supabase
      .from('journey_order_links')
      .select('id')
      .eq('journey_config_id', id)
      .limit(1)

    if (linkError) {
      console.error('Error checking order links:', linkError)
      return NextResponse.json(
        { error: 'Failed to verify journey usage' },
        { status: 500 }
      )
    }

    if (linkedOrders && linkedOrders.length > 0) {
      return NextResponse.json(
        {
          error:
            'Cannot delete journey that is linked to orders. Set it as inactive instead.'
        },
        { status: 400 }
      )
    }

    // Delete the journey
    const { error: deleteError } = await supabase
      .from('journey_configurations')
      .delete()
      .eq('id', id)
      .eq('org_id', profile.organization_id)

    if (deleteError) {
      console.error('Error deleting journey:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete journey' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Journey deleted successfully'
    })
  } catch (error) {
    console.error('Error in journey delete:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
