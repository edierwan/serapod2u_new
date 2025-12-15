import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

/**
 * GET /api/user/profile
 * Get user profile information (bypasses RLS for reliable access)
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

    // Service role client for data operations (bypasses RLS)
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

    // Get the authenticated user from session
    const supabase = await createServerClient()
    let { data: { user }, error: authError } = await supabase.auth.getUser()

    // Fallback: Check Authorization header if cookie auth fails
    if (!user || authError) {
      const authHeader = request.headers.get('Authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1]
        const { data: { user: userFromToken }, error: tokenError } = await supabase.auth.getUser(token)
        
        if (userFromToken && !tokenError) {
          user = userFromToken
          authError = null
        }
      }
    }

    if (authError || !user) {
      console.error('Authentication failed:', authError)
      return NextResponse.json(
        { success: false, error: 'Not authenticated', requiresLogin: true },
        { status: 401 }
      )
    }

    console.log('✅ User authenticated:', user.email)

    // Fetch user profile using admin client (bypasses RLS)
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        full_name,
        avatar_url,
        phone,
        organization_id
      `)
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      console.error('Error fetching user profile:', profileError)
      return NextResponse.json(
        { success: false, error: 'Profile not found' },
        { status: 404 }
      )
    }

    console.log('User profile fetched:', {
      fullName: userProfile.full_name,
      avatarUrl: userProfile.avatar_url,
      phone: userProfile.phone,
      organizationId: userProfile.organization_id
    })

    // Fetch organization info if organization_id exists
    let isShop = false
    let orgName = ''

    if (userProfile.organization_id) {
      const { data: orgData, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('org_type_code, org_name')
        .eq('id', userProfile.organization_id)
        .single()

      if (orgData && !orgError) {
        isShop = orgData.org_type_code === 'SHOP'
        orgName = orgData.org_name || ''
      }
    }

    // Fetch shop points balance if it's a shop user
    let pointsBalance = 0
    if (isShop && userProfile.organization_id) {
      const { data: balanceData } = await supabaseAdmin
        .from('v_shop_points_balance')
        .select('current_balance')
        .eq('shop_id', userProfile.organization_id)
        .maybeSingle()

      pointsBalance = balanceData?.current_balance || 0
    }

    // Add cache-busting to avatar URL
    const avatarUrlWithCache = userProfile.avatar_url
      ? `${userProfile.avatar_url.split('?')[0]}?v=${Date.now()}`
      : null

    return NextResponse.json({
      success: true,
      profile: {
        id: userProfile.id,
        email: userProfile.email || user.email,
        fullName: userProfile.full_name || '',
        avatarUrl: avatarUrlWithCache,
        phone: userProfile.phone || '',
        organizationId: userProfile.organization_id,
        isShop,
        orgName,
        pointsBalance
      }
    })

  } catch (error) {
    console.error('Error in profile API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
