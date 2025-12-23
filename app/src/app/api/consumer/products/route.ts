import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  try {
    // Create admin client inside the function to avoid build-time errors
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('org_id')

    if (!orgId) {
      return NextResponse.json(
        { success: false, error: 'Organization ID is required' },
        { status: 400 }
      )
    }

    // Get the company_id from the organization (might be a shop or HQ)
    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, parent_org_id, org_type_code')
      .eq('id', orgId)
      .single()

    if (orgError || !org) {
      console.error('Error fetching organization:', orgError)
      return NextResponse.json(
        { success: false, error: 'Organization not found' },
        { status: 404 }
      )
    }

    // If it's a shop, get the parent company; otherwise use the org directly
    // For HQ, the org_id is the company
    // For shops/distributors, use parent_org_id to get the company
    let companyId = orgId
    if (org.org_type_code === 'SHOP' || org.org_type_code === 'DIST') {
      companyId = org.parent_org_id || orgId
    }

    // Fetch products for the company
    // Products are linked through manufacturer_id, but we need to find products
    // where the manufacturer belongs to this company hierarchy
    const { data: products, error } = await supabaseAdmin
      .from('products')
      .select(`
        id,
        product_code,
        product_name,
        product_description,
        brands (brand_name),
        product_categories (category_name, hide_price),
        product_images (
          image_url,
          is_primary
        ),
        product_variants (
          id,
          variant_name,
          suggested_retail_price,
          image_url
        )
      `)
      .eq('is_active', true)
      .order('product_name')
      .limit(50) // Limit for performance

    if (error) {
      console.error('Error fetching products:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch products' },
        { status: 500 }
      )
    }

    // Transform products data
    const transformedProducts = (products || []).map((item: any) => ({
      id: item.id,
      product_code: item.product_code,
      product_name: item.product_name,
      product_description: item.product_description,
      brand_name: item.brands?.brand_name || 'No Brand',
      category_name: item.product_categories?.category_name || 'Uncategorized',
      hide_price: item.product_categories?.hide_price || false,
      primary_image_url: item.product_images?.find((img: any) => img.is_primary)?.image_url || 
                        item.product_images?.[0]?.image_url || null,
      variants: item.product_variants || []
    }))

    return NextResponse.json({
      success: true,
      products: transformedProducts
    })
  } catch (error: any) {
    console.error('Error in products API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
