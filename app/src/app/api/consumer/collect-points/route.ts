import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getBaseCode } from '@/lib/security/qr-hash'

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

    // Extract base code (remove hash suffix if present)
    const baseCode = getBaseCode(qr_code)
    console.log('🔐 Collect Points - Scanned code:', qr_code)
    console.log('🔐 Collect Points - Base code:', baseCode)

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

    // 2. Find the QR code and verify it's valid
    // Try exact match first (for codes stored with hash), then try base code (for legacy codes)
    let qrCodeData: any = null
    let qrError: any = null

    // First attempt: exact match with full code (including hash if present)
    const { data: exactMatch, error: exactError } = await supabaseAdmin
      .from('qr_codes')
      .select('id, order_id, status, code')
      .eq('code', qr_code)
      .maybeSingle()

    if (exactMatch) {
      console.log('✅ Found exact match with full code')
      qrCodeData = exactMatch
    } else {
      console.log('⚠️ Exact match not found, trying base code:', baseCode)
      // Second attempt: try with base code (for legacy codes without hash suffix)
      const { data: baseMatch, error: baseError } = await supabaseAdmin
        .from('qr_codes')
        .select('id, order_id, status, code')
        .eq('code', baseCode)
        .maybeSingle()

      if (baseMatch) {
        console.log('✅ Found match with base code')
        qrCodeData = baseMatch
      } else {
        qrError = baseError || exactError
      }
    }

    if (!qrCodeData) {
      console.error('QR code not found:', qrError)
      console.error('Tried codes:', { full: qr_code, base: baseCode })
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

    // 4. Check if points already collected for this QR code
    const { data: existingCollection, error: checkError } = await supabaseAdmin
      .from('consumer_qr_scans')
      .select('id, points_amount, shop_id, points_collected_at')
      .eq('qr_code_id', qrCodeData.id)
      .eq('collected_points', true)
      .maybeSingle()

    if (existingCollection) {
      console.log('⚠️ Points already collected:', {
        qr_code: qrCodeData.code,
        collected_at: existingCollection.points_collected_at,
        shop_id: existingCollection.shop_id,
        points: existingCollection.points_amount
      })
      
      return NextResponse.json({
        success: true,
        already_collected: true,
        points_earned: existingCollection.points_amount || 0,
        message: 'Points already collected for this QR code'
      })
    }

    console.log('✅ No existing collection found, proceeding to award points')

    // 5. Get points configuration from organization's point rules
    const { data: pointRule, error: ruleError } = await supabaseAdmin
      .from('point_rules')
      .select('points_per_scan, rule_name')
      .eq('company_id', orderData.company_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const pointsToAward = pointRule?.points_per_scan || 50 // Default to 50 if no rule

    // 6. Create consumer scan record with points
    const { data: scanRecord, error: scanError } = await supabaseAdmin
      .from('consumer_qr_scans')
      .insert({
        qr_code_id: qrCodeData.id,
        shop_id: shopUser.organization_id, // FK to organizations table (shop org)
        collected_points: true,
        points_amount: pointsToAward,
        points_collected_at: new Date().toISOString()
      })
      .select()
      .single()

    if (scanError) {
      console.error('Error recording point collection:', scanError)
      
      // Check if it's a duplicate key violation (unique constraint)
      if (scanError.code === '23505') {
        console.log('⚠️ Duplicate collection attempt detected by database constraint')
        
        // Fetch the existing collection to return proper response
        const { data: existing } = await supabaseAdmin
          .from('consumer_qr_scans')
          .select('points_amount')
          .eq('qr_code_id', qrCodeData.id)
          .eq('collected_points', true)
          .single()
        
        return NextResponse.json({
          success: true,
          already_collected: true,
          points_earned: existing?.points_amount || 0,
          message: 'Points already collected for this QR code'
        })
      }
      
      return NextResponse.json(
        { success: false, error: 'Failed to record point collection: ' + scanError.message },
        { status: 500 }
      )
    }

    // 7. Calculate total points collected by this shop organization
    const { data: allScans } = await supabaseAdmin
      .from('consumer_qr_scans')
      .select('points_amount')
      .eq('shop_id', shopUser.organization_id)
      .eq('collected_points', true)

    const totalBalance = allScans?.reduce((sum, scan) => {
      return sum + (scan.points_amount || 0)
    }, 0) || pointsToAward

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
