import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/admin/redemption-history
 * Get all redemptions for admin's company (including all shops under the company)
 */
export async function GET(request: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing Supabase environment variables')
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // Use service role client to bypass RLS
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Create regular client for auth check
    const { createClient: createServerClient } = await import('@/lib/supabase/server')
    const supabase = await createServerClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Please log in to view redemption history' },
        { status: 401 }
      )
    }

    // Get user's organization
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('id, organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile || !userProfile.organization_id) {
      console.error('❌ User profile not found:', profileError)
      return NextResponse.json(
        { success: false, error: 'User profile not found' },
        { status: 404 }
      )
    }

    // Get organization details
    const { data: organization, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, org_type_code, org_name')
      .eq('id', userProfile.organization_id)
      .single()

    if (orgError || !organization) {
      console.error('❌ Organization not found:', orgError)
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      )
    }

    const companyId = organization.id

    console.log('🎁 Loading redemptions for company:', companyId, organization.org_name)

    // Query v_admin_redemptions view directly with service role (bypasses RLS)
    const { data: redemptions, error: redemptionsError } = await supabaseAdmin
      .from('v_admin_redemptions')
      .select('*')
      .eq('company_id', companyId)
      .order('redeemed_at', { ascending: false })

    if (redemptionsError) {
      console.error('❌ Error fetching redemptions from view:', redemptionsError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch redemption history' },
        { status: 500 }
      )
    }

    console.log('✅ Loaded redemptions:', redemptions?.length || 0)

    return NextResponse.json({
      success: true,
      redemptions: redemptions || [],
      count: redemptions?.length || 0
    })

  } catch (error) {
    console.error('Error in admin/redemption-history:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
