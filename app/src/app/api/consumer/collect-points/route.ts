import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveQrCodeRecord, checkPointsCollected, calculateShopTotalPoints } from '@/lib/utils/qr-resolver'

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
    
    const { qr_code, shop_id, password } = await request.json()

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
    
    // Try to sign in with Supabase Auth
    const { data: authData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
      email: shop_id, // shop_id should be email
      password: password
    })

    if (signInError || !authData.user) {
      console.error('Authentication failed:', signInError)
      return NextResponse.json(
        { success: false, error: 'Invalid shop ID or password' },
        { status: 401 }
      )
    }

    console.log('✅ User authenticated:', authData.user.email)

    // Clear session to avoid keeping auth active (no need for persistent session)
    await supabaseAuth.auth.signOut()

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
        organizations!fk_users_organization(
          id,
          org_type_code,
          org_name,
          org_code,
          parent_org_id
        )
      `)
      .eq('id', authData.user.id)
      .single()

    if (profileError || !shopUser) {
      console.error('User profile not found:', profileError)
      return NextResponse.json(
        { success: false, error: 'User profile not found.' },
        { status: 403 }
      )
    }

    // 3. Verify user belongs to a SHOP organization
    const organization = shopUser.organizations as any
    if (!organization || organization.org_type_code !== 'SHOP') {
      console.error('User is not from a shop organization:', organization?.org_type_code)
      return NextResponse.json(
        { 
          success: false, 
          error: 'Only users from shop organizations can collect points.',
          details: `Your organization type is: ${organization?.org_type_code || 'unknown'}`
        },
        { status: 403 }
      )
    }

    console.log('✅ Shop user verified:', shopUser.email, '| Organization:', organization.org_name)

    // 2. Resolve QR code record (handles both new codes with hash and legacy codes)
    const qrCodeData = await resolveQrCodeRecord(supabaseAdmin, qr_code)

    if (!qrCodeData) {
      console.error('❌ QR code not found in database')
      return NextResponse.json(
        { 
          success: false, 
          error: 'This QR code is not yet active in the system. This is a preview/demo code.',
          preview: true
        },
        { status: 404 }
      )
    }

    console.log('✅ QR Code found:', qrCodeData.code)

    // CRITICAL: Check if points already collected BEFORE any other validation
    // This ensures idempotency - once collected, always return already_collected
    const existingCollection = await checkPointsCollected(supabaseAdmin, qrCodeData.id)

    if (existingCollection) {
      console.log('⚠️ Points already collected for this QR code')
      console.log('   Collected at:', existingCollection.points_collected_at)
      console.log('   Shop:', existingCollection.shop_id)
      console.log('   Points:', existingCollection.points_amount)
      
      // Calculate total balance for response
      const totalBalance = existingCollection.shop_id 
        ? await calculateShopTotalPoints(supabaseAdmin, existingCollection.shop_id)
        : existingCollection.points_amount || 0
      
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

    console.log('✅ No existing collection found, proceeding with validation')

    // Only allow valid statuses
    const validStatuses = ['received_warehouse', 'warehouse_packed', 'shipped_distributor', 'activated', 'verified']
    if (!qrCodeData.status || !validStatuses.includes(qrCodeData.status)) {
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
    const isSameOrg = organization.id === orderOrganization.id
    const isShopCollectingFromHQ = organization.org_type_code === 'SHOP' && orderOrganization.org_type_code === 'HQ'
    const isParentMatch = organization.parent_org_id && organization.parent_org_id === orderOrganization.id
    const isChildMatch = orderOrganization.parent_org_id && orderOrganization.parent_org_id === organization.id
    const isSiblingMatch = organization.parent_org_id && orderOrganization.parent_org_id && organization.parent_org_id === orderOrganization.parent_org_id

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

    console.log('✅ Organization relationship validated (Shop collecting from HQ)')

    // 4. Get points configuration from organization's point rules
    // Try multiple sources: Order's company, Shop's parent org, or Shop's org
    console.log('🔍 Looking for point rule for org_id:', orderData.company_id)
    
    let pointRule = null
    let ruleError = null
    
    // First, try to get rule from order's company (HQ organization)
    const { data: rule1, error: error1 } = await supabaseAdmin
      .from('points_rules')
      .select('points_per_scan, rule_name, id, org_id, is_active')
      .eq('org_id', orderData.company_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    
    if (rule1) {
      pointRule = rule1
      console.log('✅ Found point rule from order company:', orderData.company_id)
    } else if (error1) {
      console.error('⚠️ Error fetching point rule from order company:', error1)
      ruleError = error1
    }
    
    // Fallback: Try shop's parent organization (if shop is under HQ)
    if (!pointRule && organization.parent_org_id) {
      console.log('🔍 Trying shop parent org:', organization.parent_org_id)
      const { data: rule2, error: error2 } = await supabaseAdmin
        .from('points_rules')
        .select('points_per_scan, rule_name, id, org_id, is_active')
        .eq('org_id', organization.parent_org_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      
      if (rule2) {
        pointRule = rule2
        console.log('✅ Found point rule from shop parent org:', organization.parent_org_id)
      } else if (error2) {
        console.error('⚠️ Error fetching point rule from shop parent:', error2)
      }
    }

    if (!pointRule) {
      console.warn('⚠️ No active point rule found for org_id:', orderData.company_id, 'or parent:', organization.parent_org_id)
      console.warn('⚠️ Using default: 100 points')
    }

    const pointsToAward = pointRule?.points_per_scan || 100 // Default to 100 if no rule
    
    console.log('💰 Points configuration:', {
      rule_id: pointRule?.id,
      rule_name: pointRule?.rule_name,
      org_id: pointRule?.org_id,
      is_active: pointRule?.is_active,
      points_per_scan: pointRule?.points_per_scan,
      points_to_award: pointsToAward
    })

    // 5. Call RPC to collect points securely
    const { data: result, error: rpcError } = await supabaseAdmin.rpc('consumer_collect_points', {
      p_raw_qr_code: qr_code,
      p_shop_id: authData.user.id, // Pass user ID, RPC will look up org
      p_points_amount: pointsToAward
    })

    if (rpcError) {
      console.error('RPC Error:', rpcError)
      return NextResponse.json(
        { success: false, error: 'Database error: ' + rpcError.message },
        { status: 500 }
      )
    }

    // Handle RPC result
    if (!result.success) {
      if (result.already_collected) {
        // Calculate total balance for response
        const totalBalance = await calculateShopTotalPoints(supabaseAdmin, shopUser.organization_id)
        
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
      
      if (result.code === 'QR_NOT_FOUND') {
        return NextResponse.json(result, { status: 404 })
      }
      if (result.code === 'INVALID_STATUS') {
        return NextResponse.json(result, { status: 400 })
      }
      
      return NextResponse.json(result, { status: 400 })
    }

    console.log('✅ Points awarded successfully:', pointsToAward)

    // 6. Calculate total points collected by this shop organization
    const totalBalance = await calculateShopTotalPoints(supabaseAdmin, shopUser.organization_id)

    return NextResponse.json({
      success: true,
      points_earned: pointsToAward,
      total_balance: totalBalance,
      shop_name: shopUser.full_name || shopUser.email,
      qr_code: qrCodeData.code,
      message: 'Points collected successfully!'
    })

  } catch (error) {
    console.error('Error in consumer/collect-points:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
