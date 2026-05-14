import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/manufacturer/adjustments
 * Returns a list of quality & return-to-supplier adjustments visible to the current manufacturer user
 * - Super admin sees all entries
 * - Manufacturer users see entries assigned to their manufacturer org (target_manufacturer_org_id)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Fetch user's profile
    const { data: userProfile, error: profileErr } = await supabase
      .from('users')
      .select('organization_id, role_code')
      .eq('id', user.id)
      .single()

    if (profileErr) {
      return NextResponse.json({ error: 'Unable to fetch user profile' }, { status: 500 })
    }

    const reasonCodes = ['quality_issue', 'return_to_supplier', 'damaged_goods']

    // get reason ids
    const { data: reasons } = await supabase
      .from('stock_adjustment_reasons')
      .select('id, reason_code')
      .in('reason_code', reasonCodes)

    const reasonIds = (reasons || []).map((r: any) => r.id)

    let query = supabase
      .from('stock_adjustments')
      .select(
        `id, organization_id, reason_id, notes, proof_images, status, created_at, created_by, target_manufacturer_org_id, manufacturer_status, manufacturer_acknowledged_at, manufacturer_acknowledged_by, manufacturer_assigned_at, manufacturer_notes, stock_adjustment_items (*), stock_adjustment_reasons (reason_code, reason_name)`
      )
      .in('reason_id', reasonIds)
      .order('created_at', { ascending: false })

    if (userProfile.role_code !== 'SA') {
      // limit to adjustments assigned to the manufacturer organization
      query = query.eq('target_manufacturer_org_id', userProfile.organization_id)
    }

    const { data: adjustments, error } = await query

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Manually fetch created_by_user since the foreign key relationship is missing or misconfigured
    const userIds = Array.from(new Set((adjustments || []).map((a: any) => a.created_by).filter(Boolean))) as string[]

    let usersMap: Record<string, any> = {}
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, full_name, email')
        .in('id', userIds)

      if (users) {
        users.forEach((u: any) => {
          usersMap[u.id] = u
        })
      }
    }

    // Enrich with product info + images + reporter/manufacturer org names
    const variantIds = Array.from(new Set(
      (adjustments || []).flatMap((a: any) => (a.stock_adjustment_items || []).map((it: any) => it.variant_id).filter(Boolean))
    )) as string[]

    let variantsMap: Record<string, any> = {}
    let productImagesMap: Record<string, string> = {}
    if (variantIds.length > 0) {
      const { data: variants } = await supabase
        .from('product_variants')
        .select('id, variant_name, variant_code, manufacturer_sku, image_url, product_id, products(id, product_name, product_code, brand_name, category_name)')
        .in('id', variantIds)
      if (variants) {
        const productIds: string[] = []
        variants.forEach((v: any) => {
          variantsMap[v.id] = v
          if (v.product_id) productIds.push(v.product_id)
          if (v.product_id && v.image_url && !productImagesMap[v.product_id]) {
            productImagesMap[v.product_id] = v.image_url
          }
        })
        if (productIds.length > 0) {
          const { data: images } = await supabase
            .from('product_images')
            .select('product_id, image_url, is_primary, sort_order')
            .in('product_id', Array.from(new Set(productIds)))
            .eq('is_active', true)
            .order('is_primary', { ascending: false })
            .order('sort_order', { ascending: true })
          if (images) {
            for (const im of images) {
              if (!productImagesMap[(im as any).product_id]) {
                productImagesMap[(im as any).product_id] = (im as any).image_url
              }
            }
          }
        }
      }
    }

    // Org names (reporter org + target manufacturer)
    const orgIds = Array.from(new Set(
      (adjustments || []).flatMap((a: any) => [a.organization_id, a.target_manufacturer_org_id].filter(Boolean))
    )) as string[]
    let orgsMap: Record<string, any> = {}
    if (orgIds.length > 0) {
      const { data: orgs } = await supabase
        .from('organizations')
        .select('id, org_name, org_type_code')
        .in('id', orgIds)
      if (orgs) orgs.forEach((o: any) => { orgsMap[o.id] = o })
    }

    const data = (adjustments || []).map((a: any) => ({
      ...a,
      created_by_user: usersMap[a.created_by] || null,
      reporter_org: orgsMap[a.organization_id] || null,
      manufacturer_org: orgsMap[a.target_manufacturer_org_id] || null,
      stock_adjustment_items: (a.stock_adjustment_items || []).map((it: any) => {
        const v = variantsMap[it.variant_id]
        const productId = v?.product_id
        return {
          ...it,
          product_name: v?.products?.product_name || it.product_name || null,
          sku: v?.manufacturer_sku || v?.variant_code || it.sku || null,
          variant_name: v?.variant_name || null,
          product_image: productId ? productImagesMap[productId] || null : null,
        }
      }),
    }))

    return NextResponse.json({ data })
  } catch (err: any) {
    console.error('GET /api/manufacturer/adjustments error', err)
    return NextResponse.json({ error: 'Unable to load issues right now' }, { status: 500 })
  }
}
