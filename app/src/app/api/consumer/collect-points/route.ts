import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveQrCodeRecord, resolveTrustedPointsBalance } from '@/lib/utils/qr-resolver'
import {
  normalizePointClaimSettings,
  resolveClaimLaneExperience,
} from '@/lib/engagement/point-claim-settings'
import { resolveCollectProfileCompletion } from '@/lib/engagement/profile-completion'
import { resolveProfileLinkValidation } from '@/lib/engagement/profile-link-validation'

/**
 * POST /api/consumer/collect-points
 * Authenticate shop user and award points to consumer
 * 
 * Body:
 *   qr_code: string - The QR code that was scanned (with or without hash suffix)
 *   shop_id: string - Shop user ID (username/phone)
 *   password: string - Shop password
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
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

    // Public client for authenticating shop credentials
    const supabaseAuth = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { qr_code, shop_id, password, preferred_claim_lane, consumer_confirmation } = await request.json()

    // Validate required fields
    if (!qr_code || !shop_id || !password) {
      return NextResponse.json(
        { success: false, error: 'QR code, shop ID, and password are required' },
        { status: 400 }
      )
    }

    console.log('🔐 Collect Points - Scanned code:', qr_code)

    // 1. Authenticate shop user using Supabase Auth
    console.log('🔐 Authenticating shop user:', shop_id)

    let emailToAuth = shop_id
    let authenticatedUserId: string | null = null

    // Check if shop_id is a phone number (simple check: doesn't contain @)
    if (!shop_id.includes('@')) {
      console.log('📱 Detected phone number login, looking up email...')

      // Normalize phone to try multiple formats
      const rawPhone = shop_id.replace(/[^0-9+]/g, '')
      let withoutPlus = rawPhone.replace(/^\+/, '')
      if (withoutPlus.startsWith('0')) {
        withoutPlus = '60' + withoutPlus.substring(1)
      }
      const withPlus = '+' + withoutPlus
      const phonesToTry = [rawPhone, withoutPlus, withPlus]
        .filter((v, i, a) => a.indexOf(v) === i) // unique

      // Query candidates with org info to filter out HQ/non-consumer users
      const { data: usersByPhone } = await supabaseAdmin
        .from('users')
        .select('id, email, organization_id, organizations!fk_users_organization(org_type_code)')
        .in('phone', phonesToTry)
        .eq('is_active', true)

      // Only keep users eligible to collect points: no org, SHOP org, or INDEP org
      const candidateUsers = (usersByPhone || []).filter((candidate: any) => {
        if (!candidate.email) return false
        const org = candidate.organizations as any
        if (!org) return true // No org = independent consumer
        return org.org_type_code === 'SHOP' || org.org_type_code === 'INDEP'
      })

      if (candidateUsers.length === 0) {
        console.error('Phone lookup failed for formats:', phonesToTry)
        return NextResponse.json(
          { success: false, error: 'No account found for this phone number. Please register first.', noAccount: true },
          { status: 401 }
        )
      }

      let matchedAuthData: any = null
      let matchedSignInError: any = null

      for (const candidate of candidateUsers) {
        const attempt = await supabaseAuth.auth.signInWithPassword({
          email: candidate.email,
          password,
        })

        if (!attempt.error && attempt.data.user) {
          matchedAuthData = attempt.data
          matchedSignInError = null
          emailToAuth = candidate.email
          authenticatedUserId = attempt.data.user.id
          console.log('📱 Phone login matched email:', emailToAuth)
          break
        }

        matchedSignInError = attempt.error
      }

      if (!matchedAuthData?.user) {
        console.error('Authentication failed for all phone candidates:', matchedSignInError)
        return NextResponse.json(
          { success: false, error: 'Incorrect password. Please try again or use Forgot Password.', wrongPassword: true },
          { status: 401 }
        )
      }

      await supabaseAuth.auth.signOut()
    } else {
      const { data: authData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
        email: emailToAuth,
        password: password
      })

      if (signInError || !authData.user) {
        console.error('Authentication failed:', signInError)
        return NextResponse.json(
          { success: false, error: 'Incorrect password. Please try again or use Forgot Password.', wrongPassword: true },
          { status: 401 }
        )
      }

      console.log('✅ User authenticated:', authData.user.email)
      authenticatedUserId = authData.user.id

      // Clear session to avoid keeping auth active (no need for persistent session)
      await supabaseAuth.auth.signOut()
    }

    // 2. Get shop user profile with organization details
    const { data: shopUser, error: profileError } = await supabaseAdmin
      .from('users')
      .select(`
        id, 
        organization_id, 
        role_code, 
        email, 
        phone, 
        full_name,
        shop_name,
        referral_phone,
        consumer_claim_confirmed_at,
        avatar_url,
        organizations!fk_users_organization(
          id,
          org_type_code,
          org_name,
          org_code,
          parent_org_id
        )
      `)
      .eq('id', authenticatedUserId)
      .single()

    if (profileError || !shopUser) {
      console.error('User profile not found:', profileError)
      return NextResponse.json(
        { success: false, error: 'User profile not found.' },
        { status: 403 }
      )
    }

    await supabaseAdmin
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', shopUser.id)

    // 3. Verify user belongs to a SHOP organization OR is an independent consumer
    const organization = shopUser.organizations as any
    const requestedClaimLane = preferred_claim_lane === 'shop' ? 'shop' : null

    // Allow if:
    // 1. User has no organization (Independent Consumer)
    // 2. User belongs to a SHOP organization
    // 3. User belongs to an INDEP organization
    if (organization && organization.org_type_code !== 'SHOP' && organization.org_type_code !== 'INDEP') {
      console.error('User is from non-shop organization:', organization?.org_type_code)
      return NextResponse.json(
        {
          success: false,
          error: 'Only users from shop organizations or independent consumers can collect points.',
          details: `Your organization type is: ${organization?.org_type_code || 'unknown'}`
        },
        { status: 403 }
      )
    }

    console.log('✅ User verified:', shopUser.email, '| Organization:', organization?.org_name || 'Independent Consumer', '| Requested lane:', requestedClaimLane || 'auto')

    // 2. Resolve QR code record (handles both new codes with hash and legacy codes)
    const qrCodeData = await resolveQrCodeRecord(supabaseAdmin, qr_code)

    if (!qrCodeData) {
      console.error('❌ QR code not found in database')
      return NextResponse.json(
        {
          success: false,
          error: 'This QR code is not registered in our system. It may be a preview code or hasn\'t been activated yet. Please scan a QR code from an actual product.',
          preview: true
        },
        { status: 404 }
      )
    }

    console.log('✅ QR Code found:', qrCodeData.code)

    // Only allow valid statuses - must be shipped/activated/verified to collect points
    // Include 'redeemed' and 'scanned' for already-used codes that might still need points collection
    const validStatuses = ['received_warehouse', 'warehouse_packed', 'shipped_distributor', 'activated', 'verified', 'redeemed', 'scanned']
    if (!qrCodeData.status || !validStatuses.includes(qrCodeData.status)) {
      console.log('❌ Invalid QR status:', qrCodeData.status, '| Valid:', validStatuses)
      return NextResponse.json(
        { success: false, error: 'QR code is not active or has not been shipped yet' },
        { status: 400 }
      )
    }

    // 3. Get the order details using order_id from QR code (same as lucky draw API)
    console.log('📦 Looking up order by order_id:', qrCodeData.order_id)
    const { data: orderData, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, company_id, order_no')
      .eq('id', qrCodeData.order_id)
      .single()

    if (orderError || !orderData) {
      console.error('❌ Order not found:', orderError)
      console.error('QR Code:', qrCodeData.code, 'has order_id:', qrCodeData.order_id)
      return NextResponse.json(
        {
          success: false,
          error: 'Order not found',
          details: 'The order associated with this QR code does not exist in the database.'
        },
        { status: 404 }
      )
    }

    console.log('✅ Order found:', orderData.order_no)

    // Fetch order organization to compare hierarchy
    const { data: orderOrganization, error: orderOrgError } = await supabaseAdmin
      .from('organizations')
      .select('id, org_type_code, parent_org_id')
      .eq('id', orderData.company_id)
      .single()

    if (orderOrgError || !orderOrganization) {
      console.error('❌ Order organization not found:', orderOrgError)
      return NextResponse.json(
        {
          success: false,
          error: 'Order organization not found'
        },
        { status: 404 }
      )
    }

    // Allow shops to collect points for orders from any HQ organization
    // Shops work with multiple HQs, so we validate by org type rather than strict hierarchy
    let isSameOrg = false
    let isShopCollectingFromHQ = false
    let isParentMatch = false
    let isChildMatch = false
    let isSiblingMatch = false

    if (organization) {
      isSameOrg = organization.id === orderOrganization.id
      isShopCollectingFromHQ = organization.org_type_code === 'SHOP' && orderOrganization.org_type_code === 'HQ'
      isParentMatch = organization.parent_org_id && organization.parent_org_id === orderOrganization.id
      isChildMatch = orderOrganization.parent_org_id && orderOrganization.parent_org_id === organization.id
      isSiblingMatch = organization.parent_org_id && orderOrganization.parent_org_id && organization.parent_org_id === orderOrganization.parent_org_id

      if (!isSameOrg && !isShopCollectingFromHQ && !isParentMatch && !isChildMatch && !isSiblingMatch) {
        console.error('Organization mismatch:', {
          shopOrg: {
            id: organization.id,
            parent_org_id: organization.parent_org_id,
            org_type_code: organization.org_type_code
          },
          orderOrg: orderOrganization
        })
        return NextResponse.json(
          { success: false, error: 'This product does not belong to your organization' },
          { status: 403 }
        )
      }
    } else {
      console.log('✅ Independent consumer collecting points (skipping org hierarchy check)')
    }

    console.log('✅ Organization relationship validated')

    // 4. Get points configuration from organization's point rules
    // Try multiple sources: Order's company, Shop's parent org, or Shop's org
    console.log('🔍 Looking for point rule for org_id:', orderData.company_id)

    let pointRule = null
    let ruleError = null

    // First, try to get rule from order's company (HQ organization)
    const { data: rule1, error: error1 } = await supabaseAdmin
      .from('points_rules')
      .select('points_per_scan, name, id, org_id, is_active')
      .eq('org_id', orderData.company_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (rule1) {
      pointRule = rule1
      console.log('✅ Found point rule from order company:', orderData.company_id, 'Points:', rule1.points_per_scan)
    } else if (error1) {
      console.error('⚠️ Error fetching point rule from order company:', error1)
      ruleError = error1
    } else {
      console.log('⚠️ No point rule found for order company:', orderData.company_id)
    }

    // Fallback: Try shop's parent organization (if shop is under HQ)
    if (!pointRule && organization && organization.parent_org_id) {
      console.log('🔍 Trying shop parent org:', organization.parent_org_id)
      const { data: rule2, error: error2 } = await supabaseAdmin
        .from('points_rules')
        .select('points_per_scan, name, id, org_id, is_active')
        .eq('org_id', organization.parent_org_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (rule2) {
        pointRule = rule2
        console.log('✅ Found point rule from shop parent org:', organization.parent_org_id, 'Points:', rule2.points_per_scan)
      } else if (error2) {
        console.error('⚠️ Error fetching point rule from shop parent:', error2)
      } else {
        console.log('⚠️ No point rule found for shop parent org:', organization.parent_org_id)
      }
    }

    // Fallback: Try order company's parent organization (if order org has parent)
    if (!pointRule && orderOrganization.parent_org_id) {
      console.log('🔍 Trying order company parent org:', orderOrganization.parent_org_id)
      const { data: rule3, error: error3 } = await supabaseAdmin
        .from('points_rules')
        .select('points_per_scan, name, id, org_id, is_active')
        .eq('org_id', orderOrganization.parent_org_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (rule3) {
        pointRule = rule3
        console.log('✅ Found point rule from order company parent:', orderOrganization.parent_org_id, 'Points:', rule3.points_per_scan)
      } else if (error3) {
        console.error('⚠️ Error fetching point rule from order company parent:', error3)
      }
    }

    // Final fallback: Try to get ANY active rule (in case org structure is different)
    if (!pointRule) {
      console.log('🔍 Final fallback: Looking for any active rule associated with order or shop orgs')
      const orgIds = [
        orderData.company_id,
        organization?.id,
        organization?.parent_org_id,
        orderOrganization.parent_org_id
      ].filter(Boolean)

      const { data: anyRule, error: anyError } = await supabaseAdmin
        .from('points_rules')
        .select('points_per_scan, name, id, org_id, is_active')
        .in('org_id', orgIds)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (anyRule) {
        pointRule = anyRule
        console.log('✅ Found point rule via fallback search:', anyRule.org_id, 'Points:', anyRule.points_per_scan)
      } else {
        console.log('⚠️ No active point rule found in any related organization')
      }
    }

    if (!pointRule) {
      console.warn('⚠️ No active point rule found for org_id:', orderData.company_id, 'or parent:', organization?.parent_org_id)
      console.warn('⚠️ Using default: 100 points')
    }

    const settingsOrgId = pointRule?.org_id || orderData.company_id || organization?.parent_org_id || organization?.id
    let pointClaimSettings = normalizePointClaimSettings(null, pointRule?.points_per_scan || 100)

    if (settingsOrgId) {
      const { data: settingsOrg } = await supabaseAdmin
        .from('organizations')
        .select('settings')
        .eq('id', settingsOrgId)
        .maybeSingle()

      pointClaimSettings = normalizePointClaimSettings(settingsOrg?.settings, pointRule?.points_per_scan || 100)
    }

    const laneExperience = resolveClaimLaneExperience({
      claimMode: pointClaimSettings.claimMode,
      organization_id: shopUser.organization_id,
      organizationTypeCode: organization?.org_type_code,
      shop_name: shopUser.shop_name,
      referral_phone: shopUser.referral_phone,
      consumerClaimConfirmedAt: shopUser.consumer_claim_confirmed_at,
      consumerConfirmation: consumer_confirmation === true,
      preferredClaimLane: requestedClaimLane,
    })
    const linkValidation = await resolveProfileLinkValidation(supabaseAdmin, {
      organizationId: shopUser.organization_id,
      shopName: shopUser.shop_name,
      referralPhone: shopUser.referral_phone,
    })
    const claimLane = laneExperience.claimLane
    const profileCompletion = resolveCollectProfileCompletion({
      name: shopUser.full_name,
      claimLane,
      requestedClaimLane,
      organizationId: shopUser.organization_id,
      organizationTypeCode: organization?.org_type_code,
      shopName: shopUser.shop_name,
      referralPhone: shopUser.referral_phone,
      isShopLinkValid: linkValidation.isShopLinkValid,
      isReferenceLinkValid: linkValidation.isReferenceLinkValid,
    })

    if (laneExperience.shouldPromptConsumerChoice) {
      return NextResponse.json(
        {
          success: false,
          requiresConsumerConfirmation: true,
          email: emailToAuth,
          modalTitle: 'Choose Claim Type',
          modalMessage: 'Choose whether to continue as a consumer or update your profile to claim as shop staff.',
          consumerOptionLabel: 'Consumer',
          shopOptionLabel: 'Belong to Shop',
          claim_mode: pointClaimSettings.claimMode,
          error: 'Choose whether to continue as a consumer or update your profile to claim as shop staff.',
        },
        { status: 409 }
      )
    }

    if (profileCompletion.shouldBlockCollect) {
      return NextResponse.json(
        {
          success: false,
          code: 'PROFILE_INCOMPLETE',
          requiresProfileUpdate: true,
          email: emailToAuth,
          missingFields: profileCompletion.missingFields,
          missingShop: profileCompletion.missingShop,
          missingReference: profileCompletion.missingReference,
          invalidShop: profileCompletion.invalidShop,
          invalidReference: profileCompletion.invalidReference,
          shouldBlockCollect: profileCompletion.shouldBlockCollect,
          modalTitle: profileCompletion.modalTitle,
          modalMessage: profileCompletion.modalMessage,
          error: profileCompletion.modalMessage,
        },
        { status: 400 }
      )
    }

    if (claimLane === 'consumer' && consumer_confirmation && !shopUser.consumer_claim_confirmed_at) {
      const confirmedAt = new Date().toISOString()
      const { error: confirmationError } = await supabaseAdmin
        .from('users')
        .update({ consumer_claim_confirmed_at: confirmedAt, updated_at: confirmedAt })
        .eq('id', shopUser.id)

      if (confirmationError) {
        console.error('Failed to persist consumer claim confirmation:', confirmationError)
        return NextResponse.json(
          { success: false, error: 'Unable to save consumer confirmation right now. Please try again.' },
          { status: 500 }
        )
      }

      shopUser.consumer_claim_confirmed_at = confirmedAt
    }

    const pointsToAward = claimLane === 'shop'
      ? pointClaimSettings.shopPointsPerScan
      : pointClaimSettings.consumerPointsPerScan

    console.log('💰 Points configuration:', {
      rule_id: pointRule?.id,
      rule_name: pointRule?.name,
      org_id: pointRule?.org_id,
      is_active: pointRule?.is_active,
      points_per_scan: pointRule?.points_per_scan,
      points_to_award: pointsToAward,
      claim_mode: pointClaimSettings.claimMode,
      claim_lane: claimLane
    })
    console.log('⚠️ PASSING TO RPC:', {
      p_raw_qr_code: qr_code,
      p_shop_id: authenticatedUserId,
      p_points_amount: pointsToAward
    })

    // 5. Call RPC to collect points securely
    const { data: result, error: rpcError } = await supabaseAdmin.rpc('consumer_collect_points', {
      p_raw_qr_code: qr_code,
      p_shop_id: authenticatedUserId, // Pass user ID, RPC will look up org
      p_points_amount: pointsToAward,
      p_claim_lane: claimLane,
      p_allow_dual_claim: pointClaimSettings.claimMode === 'dual'
    })

    console.log('⚠️ RPC RESULT:', result)

    if (rpcError) {
      console.error('RPC Error:', rpcError)
      return NextResponse.json(
        { success: false, error: 'Database error: ' + rpcError.message },
        { status: 500 }
      )
    }

    const beforeBalance = await resolveTrustedPointsBalance(supabaseAdmin, {
      userId: authenticatedUserId,
      roleCode: shopUser.role_code,
      organizationId: shopUser.organization_id,
    })

    const calculateBalance = async () => resolveTrustedPointsBalance(supabaseAdmin, {
      userId: authenticatedUserId,
      roleCode: shopUser.role_code,
      organizationId: shopUser.organization_id,
    })

    // Handle RPC result
    if (!result.success) {
      if (result.already_collected) {
        // Calculate total balance for response
        const totalBalance = await calculateBalance()
        const remainingLane = pointClaimSettings.claimMode === 'dual'
          ? (claimLane === 'shop' ? 'consumer' : 'shop')
          : null
        const errorMessage = remainingLane
          ? `This QR code was already collected by the ${claimLane === 'shop' ? 'shop staff' : 'consumer'} lane. Only ${remainingLane === 'shop' ? 'shop staff' : 'consumer'} can collect it now.`
          : 'Points for this QR code have already been collected.'

        return NextResponse.json(
          {
            success: false,
            already_collected: true,
            error: errorMessage,
            points_earned: result.points_earned || 0,
            total_balance: totalBalance.balance,
            balance_source: totalBalance.source,
            email: emailToAuth,
            claim_mode: pointClaimSettings.claimMode,
            claim_lane: claimLane,
            remaining_lane_available: remainingLane,
            consumer_claim_confirmed_at: shopUser.consumer_claim_confirmed_at || null
          },
          { status: 409 }
        )
      }

      if (result.code === 'QR_NOT_FOUND') {
        return NextResponse.json(result, { status: 404 })
      }
      if (result.code === 'INVALID_STATUS') {
        return NextResponse.json(result, { status: 400 })
      }

      return NextResponse.json(result, { status: 400 })
    }

    console.log('✅ Points awarded successfully:', pointsToAward)

    try {
      if (orderData.company_id && authenticatedUserId) {
        await supabaseAdmin.rpc('evaluate_user_registration_bonus' as any, {
          p_org_id: orderData.company_id,
          p_user_id: authenticatedUserId,
        })
      }
    } catch (bonusError) {
      console.warn('Registration bonus evaluation skipped:', bonusError)
    }

    // 6. Calculate total points collected
    const totalBalance = await calculateBalance()

    console.info('POINT_CLAIM_AUDIT', {
      user_id: authenticatedUserId,
      consumer_id: authenticatedUserId,
      shop_id: shopUser.organization_id || null,
      qr_code_id: qrCodeData.id,
      claim_lane: claimLane,
      role_code: shopUser.role_code,
      before_balance: beforeBalance.balance,
      delta: pointsToAward,
      after_balance: totalBalance.balance,
      source_ledger: totalBalance.source,
    })

    if (totalBalance.balance < beforeBalance.balance) {
      console.warn('POINT_CLAIM_ANOMALY', {
        user_id: authenticatedUserId,
        consumer_id: authenticatedUserId,
        shop_id: shopUser.organization_id || null,
        qr_code_id: qrCodeData.id,
        claim_lane: claimLane,
        before_balance: beforeBalance.balance,
        delta: pointsToAward,
        after_balance: totalBalance.balance,
        source_ledger: totalBalance.source,
        reason: 'balance_decreased_after_earn_claim',
      })
    }

    return NextResponse.json({
      success: true,
      points_earned: pointsToAward,
      total_balance: totalBalance.balance,
      balance_source: totalBalance.source,
      shop_name: shopUser.full_name || shopUser.email,
      qr_code: qrCodeData.code,
      message: 'Points collected successfully!',
      email: emailToAuth, // Return email for client-side session handling
      avatar_url: shopUser.avatar_url,
      claim_mode: pointClaimSettings.claimMode,
      claim_lane: claimLane,
      consumer_claim_confirmed_at: shopUser.consumer_claim_confirmed_at || null
    })

  } catch (error) {
    console.error('Error in consumer/collect-points:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
