import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/consumer/scanned-products
 * Get authenticated shop user's scanned products history
 * Returns products grouped by product+variant with scan count and total points earned
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

    // Get scanned products - filter by shop_id (organization ID)
    const { data: scans, error: scansError } = await supabaseAdmin
      .from('consumer_qr_scans')
      .select(`
        id,
        scanned_at,
        collected_points,
        points_amount,
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
            description,
            variant_name
          )
        )
      `)
      .eq('shop_id', shopId)
      .eq('collected_points', true)
      .order('scanned_at', { ascending: false })

    if (scansError) {
      console.error('❌ Error fetching scanned products:', scansError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch scanned products' },
        { status: 500 }
      )
    }

    // Group scans by product + variant for summary view
    const productSummary: { [key: string]: {
      product_id: string
      product_name: string
      variant_name: string | null
      product_image_url: string | null
      scan_count: number
      total_points: number
      last_scanned_at: string
    }} = {}

    // Individual scans for detail view
    const formattedScans = (scans || []).map(scan => {
      const qrCode = scan.qr_codes as any
      const product = qrCode?.products as any
      
      // Build grouping key
      const productId = product?.id || 'unknown'
      const variantName = product?.variant_name || ''
      const groupKey = `${productId}-${variantName}`
      
      // Update summary
      if (product) {
        if (!productSummary[groupKey]) {
          productSummary[groupKey] = {
            product_id: product.id,
            product_name: product.product_name,
            variant_name: product.variant_name || null,
            product_image_url: product.product_image_url || null,
            scan_count: 0,
            total_points: 0,
            last_scanned_at: scan.scanned_at
          }
        }
        productSummary[groupKey].scan_count++
        productSummary[groupKey].total_points += (scan.points_amount || 0)
        if (scan.scanned_at > productSummary[groupKey].last_scanned_at) {
          productSummary[groupKey].last_scanned_at = scan.scanned_at
        }
      }

      return {
        id: scan.id,
        scanned_at: scan.scanned_at,
        collected_points: scan.collected_points,
        points_amount: scan.points_amount,
        points_collected_at: scan.points_collected_at,
        entered_lucky_draw: scan.entered_lucky_draw,
        qr_code: qrCode?.code || null,
        product: product ? {
          id: product.id,
          name: product.product_name,
          code: product.product_code,
          image_url: product.product_image_url,
          description: product.description,
          variant_name: product.variant_name
        } : null
      }
    })

    // Convert summary to array sorted by scan count
    const productSummaryArray = Object.values(productSummary).sort((a, b) => b.scan_count - a.scan_count)

    return NextResponse.json({
      success: true,
      scans: formattedScans,
      summary: productSummaryArray,
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
