import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { resolveTrustedPointsBalance } from '@/lib/utils/qr-resolver'
import { resolveProfileLinkValidation } from '@/lib/engagement/profile-link-validation'
import { getIncompleteProfileMessage } from '@/lib/engagement/profile-completion'

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
        call_name,
        avatar_url,
        phone,
        referral_phone,
        address,
        shop_name,
        consumer_claim_confirmed_at,
        role_code,
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

    const linkValidation = await resolveProfileLinkValidation(supabaseAdmin, {
      organizationId: userProfile.organization_id,
      shopName: userProfile.shop_name,
      referralPhone: userProfile.referral_phone,
    })

    // Fetch organization info if organization_id exists
    let isShop = false
    let orgName = linkValidation.organizationName || ''
    let bankId = null
    let bankName = null
    let bankAccountNumber = null
    let bankAccountHolderName = null
    const referenceDisplayName = linkValidation.referenceDisplayName

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
    // GUEST/CONSUMER users always use consumer balance, even if linked to a shop org
    const pointsBalance = (await resolveTrustedPointsBalance(supabaseAdmin, {
      userId: user.id,
      roleCode: userProfile.role_code,
      organizationId: userProfile.organization_id,
    })).balance

    // Add cache-busting to avatar URL
    const avatarUrlWithCache = userProfile.avatar_url
      ? `${userProfile.avatar_url.split('?')[0]}?v=${Date.now()}`
      : null

    // Compute profile completeness for collecting points
    const shopComplete = linkValidation.isShopLinkValid
    const referenceComplete = linkValidation.isReferenceLinkValid
    const profileIncomplete = !shopComplete || !referenceComplete
    const missingShop = !linkValidation.hasShopValue
    const missingReference = !linkValidation.hasReferenceValue
    const profileIncompleteMessage = profileIncomplete
      ? getIncompleteProfileMessage({
          name: userProfile.full_name,
          missingShop,
          missingReference,
          invalidShop: linkValidation.invalidShop,
          invalidReference: linkValidation.invalidReference,
        })
      : ''

    return NextResponse.json({
      success: true,
      profile: {
        id: userProfile.id,
        email: userProfile.email || user.email,
        fullName: userProfile.full_name || '',
        callName: userProfile.call_name || '',
        avatarUrl: avatarUrlWithCache,
        phone: userProfile.phone || '',
        referralPhone: userProfile.referral_phone || '',
        referenceUserId: linkValidation.referenceUserId,
        referenceDisplayName,
        invalidReference: linkValidation.invalidReference,
        invalidShop: linkValidation.invalidShop,
        isReferenceValid: linkValidation.isReferenceLinkValid,
        isShopValid: linkValidation.isShopLinkValid,
        profileIncomplete,
        profileIncompleteMessage,
        address: userProfile.address || '',
        shop_name: userProfile.shop_name,
        consumerClaimConfirmedAt: userProfile.consumer_claim_confirmed_at || null,
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
