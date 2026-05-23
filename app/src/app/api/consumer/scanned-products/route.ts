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

    let query = supabaseAdmin
      .from('shop_points_ledger')
      .select('*')
      .eq('transaction_type', 'scan')
      .order('occurred_at', { ascending: false })
      .limit(100)

    query = query.eq('consumer_id', user.id)

    // Execute query
    const { data: ledgerData, error: ledgerError } = await query

    if (ledgerError) {
      console.error('❌ Error fetching scanned products:', ledgerError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch scanned products' },
        { status: 500 }
      )
    }

    // Get unique variant IDs to fetch images
    const variantIds = Array.from(new Set((ledgerData || []).map((entry: any) => entry.variant_id).filter(Boolean)))
    let variantImagesMap: { [key: string]: string } = {}

    if (variantIds.length > 0) {
      const { data: variants } = await supabaseAdmin
        .from('product_variants')
        .select('id, image_url')
        .in('id', variantIds)

      if (variants) {
        const tempMap: { [key: string]: string } = {}
        variants.forEach((v: any) => {
          tempMap[v.id] = v.image_url
        })
        variantImagesMap = tempMap
      }
    }

    // Create a summary grouped by product and variant
    const productMapData: { [key: string]: any } = {};

    (ledgerData || []).forEach((entry: any) => {
      if (entry.product_name) {
        const productName = entry.product_name || 'Unknown Product'
        const variantName = entry.variant_name || 'Unknown Variant'
        const key = `${productName}|${variantName}`

        if (productMapData[key]) {
          productMapData[key].scan_count += 1
          productMapData[key].total_points += entry.points_change || 0
        } else {
          productMapData[key] = {
            product_name: productName,
            variant_name: variantName,
            scan_count: 1,
            total_points: entry.points_change || 0,
            image_url: entry.variant_id ? variantImagesMap[entry.variant_id] : null,
            last_scanned: entry.occurred_at
          }
        }
      }
    })

    // Convert to array and sort by scan count
    const formattedScans = Object.values(productMapData)
      .sort((a: any, b: any) => b.scan_count - a.scan_count)

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
