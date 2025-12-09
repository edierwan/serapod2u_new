import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/consumer/scanned-products
 * Get authenticated shop user's scanned products history
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
        { success: false, error: 'Please log in to view scanned products' },
        { status: 401 }
      )
    }

    // Get user's organization (shop)
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('id, organization_id, phone')
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

    if (organization.org_type_code !== 'SHOP') {
      return NextResponse.json(
        { success: false, error: 'Only shop users can view scanned products' },
        { status: 403 }
      )
    }

    const shopId = organization.id

    // Get scanned products - join consumer_qr_scans with qr_codes and products
    // Filter by consumer_id matching user.id OR by scans where points were collected for this shop
    const { data: scans, error: scansError } = await supabaseAdmin
      .from('consumer_qr_scans')
      .select(`
        id,
        scanned_at,
        collected_points,
        points_collected_at,
        entered_lucky_draw,
        qr_codes (
          id,
          code,
          product_id,
          products (
            id,
            product_name,
            product_code,
            product_image_url,
            description
          )
        )
      `)
      .eq('consumer_id', user.id)
      .order('scanned_at', { ascending: false })
      .limit(50)

    if (scansError) {
      console.error('❌ Error fetching scanned products:', scansError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch scanned products' },
        { status: 500 }
      )
    }

    // Format the response
    const formattedScans = (scans || []).map(scan => {
      const qrCode = scan.qr_codes as any
      const product = qrCode?.products as any

      return {
        id: scan.id,
        scanned_at: scan.scanned_at,
        collected_points: scan.collected_points,
        points_collected_at: scan.points_collected_at,
        entered_lucky_draw: scan.entered_lucky_draw,
        qr_code: qrCode?.code || null,
        product: product ? {
          id: product.id,
          name: product.product_name,
          code: product.product_code,
          image_url: product.product_image_url,
          description: product.description
        } : null
      }
    })

    return NextResponse.json({
      success: true,
      scans: formattedScans,
      count: formattedScans.length
    })

  } catch (error) {
    console.error('Error in consumer/scanned-products:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
