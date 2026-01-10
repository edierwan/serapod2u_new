import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { resolveQrCodeRecord, checkPointsCollected, calculateShopTotalPoints } from '@/lib/utils/qr-resolver'

/**
 * POST /api/consumer/collect-points-auth
 * Collect points using authenticated session (no password required)
 * 
 * Body:
 *   qr_code: string - The QR code that was scanned (with or without hash suffix)
 */
export async function POST(request: NextRequest) {
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
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Authentication failed:', authError)
      return NextResponse.json(
        { success: false, error: 'Not authenticated. Please log in.', requiresLogin: true },
        { status: 401 }
      )
    }

    console.log('✅ User authenticated from session:', user.email)

    const { qr_code } = await request.json()

    // Validate required fields
    if (!qr_code) {
      return NextResponse.json(
        { success: false, error: 'QR code is required' },
        { status: 400 }
      )
    }

    console.log('🔐 Collect Points (Auth) - Scanned code:', qr_code)

    // Get shop user profile with organization details
    const { data: shopUser, error: profileError } = await supabaseAdmin
      .from('users')
      .select(`
        id, 
        organization_id, 
        role_code, 
        email, 
        phone, 
        full_name,
        avatar_url,
        organizations!fk_users_organization(
          id,
          org_type_code,
          org_name,
          org_code,
          parent_org_id
        )
      `)
      .eq('id', user.id)
      .single()

    if (profileError || !shopUser) {
      console.error('User profile not found:', profileError)
      return NextResponse.json(
        { success: false, error: 'User profile not found.' },
        { status: 403 }
      )
    }

    // Verify user belongs to a SHOP organization OR is an independent consumer
    const organization = shopUser.organizations as any

    // Allow if:
    // 1. User has no organization (Independent Consumer)
    // 2. User belongs to a SHOP organization
    if (organization && organization.org_type_code !== 'SHOP') {
      console.error('User is from non-shop organization:', organization?.org_type_code)
      return NextResponse.json(
        {
          success: false,
          error: 'Only users from shop organizations or independent consumers can collect points.',
          requiresLogin: true,
          details: `Your organization type is: ${organization?.org_type_code || 'unknown'}`
        },
        { status: 403 }
      )
    }

    console.log('✅ User verified:', shopUser.email, '| Organization:', organization?.org_name || 'Independent Consumer')

    // Resolve QR code record (handles both new codes with hash and legacy codes)
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

    // CRITICAL: Check if points already collected BEFORE any other validation
    const existingCollection = await checkPointsCollected(supabaseAdmin, qrCodeData.id)

    if (existingCollection) {
      console.log('⚠️ Points already collected for this QR code')

      // For independent consumers, use user.id; for shop users, use organization_id
      const balanceId = shopUser.organization_id || user.id
      const totalBalance = await calculateShopTotalPoints(supabaseAdmin, balanceId)

      return NextResponse.json(
        {
          success: false,
          already_collected: true,
          error: 'Points for this QR code have already been collected.',
          points_earned: existingCollection.points_amount || 0,
          total_balance: totalBalance
        },
        { status: 409 }
      )
    }

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

    // Get order details
    console.log('📦 Looking up order by order_id:', qrCodeData.order_id)
    const { data: orderData, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, company_id, order_no')
      .eq('id', qrCodeData.order_id)
      .single()

    if (orderError || !orderData) {
      console.error('❌ Order not found:', orderError)
      return NextResponse.json(
        {
          success: false,
          error: 'Order not found',
          details: 'The order associated with this QR code does not exist in the database.'
        },
        { status: 404 }
      )
    }

    // Fetch order organization
    const { data: orderOrganization, error: orderOrgError } = await supabaseAdmin
      .from('organizations')
      .select('id, org_type_code, parent_org_id')
      .eq('id', orderData.company_id)
      .single()

    if (orderOrgError || !orderOrganization) {
      console.error('❌ Order organization not found:', orderOrgError)
      return NextResponse.json(
        { success: false, error: 'Order organization not found' },
        { status: 404 }
      )
    }

    // Independent consumers can collect from any QR code
    // Shop users need organization relationship validation
    const isIndependentConsumer = !organization

    if (!isIndependentConsumer) {
      // Validate organization relationship for shop users
      const isSameOrg = organization.id === orderOrganization.id
      const isShopCollectingFromHQ = organization.org_type_code === 'SHOP' && orderOrganization.org_type_code === 'HQ'
      const isParentMatch = organization.parent_org_id && organization.parent_org_id === orderOrganization.id
      const isChildMatch = orderOrganization.parent_org_id && orderOrganization.parent_org_id === organization.id
      const isSiblingMatch = organization.parent_org_id && orderOrganization.parent_org_id && organization.parent_org_id === orderOrganization.parent_org_id

      if (!isSameOrg && !isShopCollectingFromHQ && !isParentMatch && !isChildMatch && !isSiblingMatch) {
        console.error('Organization mismatch')
        return NextResponse.json(
          { success: false, error: 'This product does not belong to your organization' },
          { status: 403 }
        )
      }
    } else {
      console.log('✅ Independent consumer - skipping organization validation')
    }

    // Get points configuration - try multiple sources
    let pointRule = null

    console.log('🔍 Looking for point rule for org_id:', orderData.company_id)

    // First try order's company
    const { data: rule1 } = await supabaseAdmin
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
    } else if (organization?.parent_org_id) {
      // Fallback: shop's parent organization (only for shop users)
      console.log('🔍 Trying shop parent org:', organization.parent_org_id)
      const { data: rule2 } = await supabaseAdmin
        .from('points_rules')
        .select('points_per_scan, name, id, org_id, is_active')
        .eq('org_id', organization.parent_org_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (rule2) {
        pointRule = rule2
        console.log('✅ Found point rule from shop parent:', organization.parent_org_id, 'Points:', rule2.points_per_scan)
      }
    }

    // Fallback: Try order company's parent organization
    if (!pointRule && orderOrganization.parent_org_id) {
      console.log('🔍 Trying order company parent org:', orderOrganization.parent_org_id)
      const { data: rule3 } = await supabaseAdmin
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
      }
    }

    // Final fallback: search all related orgs
    if (!pointRule) {
      console.log('🔍 Final fallback: Looking for any active rule in related organizations')
      const orgIds = [orderData.company_id, organization?.id, organization?.parent_org_id, orderOrganization.parent_org_id].filter(Boolean)
      const { data: anyRule } = await supabaseAdmin
        .from('points_rules')
        .select('points_per_scan, name, id, org_id, is_active')
        .in('org_id', orgIds)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (anyRule) {
        pointRule = anyRule
        console.log('✅ Found point rule via fallback:', anyRule.org_id, 'Points:', anyRule.points_per_scan)
      } else {
        console.warn('⚠️ No active point rule found, using default: 100')
      }
    }

    const pointsToAward = pointRule?.points_per_scan || 100
    console.log('💰 Points to award:', pointsToAward)

    // Call RPC to collect points
    const { data: result, error: rpcError } = await supabaseAdmin.rpc('consumer_collect_points', {
      p_raw_qr_code: qr_code,
      p_shop_id: user.id,
      p_points_amount: pointsToAward
    })

    if (rpcError) {
      console.error('RPC Error:', rpcError)
      return NextResponse.json(
        { success: false, error: 'Database error: ' + rpcError.message },
        { status: 500 }
      )
    }

    // For balance calculation: use organization_id for shop users, user.id for independent consumers
    const balanceId = shopUser.organization_id || user.id

    if (!result.success) {
      if (result.already_collected) {
        const totalBalance = await calculateShopTotalPoints(supabaseAdmin, balanceId)

        return NextResponse.json(
          {
            success: false,
            already_collected: true,
            error: 'Points for this QR code have already been collected.',
            points_earned: result.points_earned || 0,
            total_balance: totalBalance
          },
          { status: 409 }
        )
      }

      return NextResponse.json(result, { status: 400 })
    }

    console.log('✅ Points awarded successfully:', pointsToAward)

    const totalBalance = await calculateShopTotalPoints(supabaseAdmin, balanceId)

    return NextResponse.json({
      success: true,
      points_earned: pointsToAward,
      total_balance: totalBalance,
      shop_name: shopUser.full_name || shopUser.email,
      qr_code: qrCodeData.code,
      message: 'Points collected successfully!',
      avatar_url: shopUser.avatar_url
    })

  } catch (error) {
    console.error('Error in consumer/collect-points-auth:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
