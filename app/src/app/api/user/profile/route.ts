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
        referral_phone,
        address,
        shop_name,
        organization_id,
        bank_id,
        bank_account_number,
        bank_account_holder_name,
        msia_banks (
            id,
            short_name
        )
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
    let bankId = null
    let bankName = null
    let bankAccountNumber = null
    let bankAccountHolderName = null

    if (userProfile.organization_id) {
      const { data: orgData, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select(`
          org_type_code, 
          org_name, 
          bank_id,
          bank_account_number, 
          bank_account_holder_name,
          msia_banks (
            id,
            short_name
          )
        `)
        .eq('id', userProfile.organization_id)
        .single()

      if (orgData && !orgError) {
        isShop = orgData.org_type_code === 'SHOP'
        orgName = orgData.org_name || ''

        if (isShop) {
          bankId = orgData.bank_id
          // Prefer the joined bank name, fallback to legacy if needed (though we are moving away from it)
          bankName = (orgData.msia_banks as any)?.short_name || null
          bankAccountNumber = orgData.bank_account_number
          bankAccountHolderName = orgData.bank_account_holder_name
        }
      }
    } else {
      // Independent Consumer - Use bank details from users table
      bankId = userProfile.bank_id
      bankName = (userProfile.msia_banks as any)?.short_name || null
      bankAccountNumber = userProfile.bank_account_number
      bankAccountHolderName = userProfile.bank_account_holder_name
    }

    // Fetch points balance
    let pointsBalance = 0
    if (isShop && userProfile.organization_id) {
      const { data: balanceData } = await supabaseAdmin
        .from('v_shop_points_balance')
        .select('current_balance')
        .eq('shop_id', userProfile.organization_id)
        .maybeSingle()

      pointsBalance = balanceData?.current_balance || 0
    } else if (!userProfile.organization_id) {
      // Independent Consumer - Use shop_points_ledger which includes all point sources
      // (consumer_qr_scans + points_transactions for migration/manual adjustments)
      const { data: ledgerData, error: ledgerError } = await supabaseAdmin
        .from('shop_points_ledger')
        .select('points_change')
        .eq('consumer_id', user.id)

      if (!ledgerError && ledgerData && ledgerData.length > 0) {
        pointsBalance = ledgerData.reduce((sum, row) => sum + (row.points_change || 0), 0)
        console.log(`💰 Points balance for consumer ${user.id} from ledger: ${pointsBalance}`)
      } else {
        // Fallback: Try v_consumer_points_balance view
        const { data: balanceData } = await supabaseAdmin
          .from('v_consumer_points_balance')
          .select('current_balance')
          .eq('user_id', user.id)
          .maybeSingle()

        if (balanceData?.current_balance) {
          pointsBalance = balanceData.current_balance
        } else {
          // Final fallback: Query consumer_qr_scans directly
          const { data: scans } = await supabaseAdmin
            .from('consumer_qr_scans')
            .select('points_amount')
            .eq('consumer_id', user.id)
            .eq('collected_points', true)

          if (scans && scans.length > 0) {
            pointsBalance = scans.reduce((sum, scan) => sum + (scan.points_amount || 0), 0)
          }
        }
      }
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
        referralPhone: userProfile.referral_phone || '',
        address: userProfile.address || '',
        shop_name: userProfile.shop_name,
        organizationId: userProfile.organization_id,
        isShop,
        orgName,
        bankId,
        bankName,
        bankAccountNumber,
        bankAccountHolderName,
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
