import { apiErrorResponse, EllbowApiError, nonNegativeInteger } from '@/lib/server/ellbow-catalog'
import { getRoadtourCatalogContext, type VisibilityOverride } from '@/lib/server/roadtour-catalog'

const OVERRIDES: VisibilityOverride[] = ['include', 'exclude']

async function loadOwnedProduct(supabase: any, productId: string) {
  const { data, error } = await supabase
    .from('products')
    .select('id, is_vape, product_categories ( is_vape )')
    .eq('id', productId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new EllbowApiError('Product not found', 404)
  const category = Array.isArray(data.product_categories) ? data.product_categories[0] : data.product_categories
  return { isVape: data.is_vape === true || category?.is_vape === true }
}

/**
 * PATCH /api/product-catalog/roadtour/products/[productId]
 * Body: { visibility_override?: 'include'|'exclude'|null, featured?: boolean, sort_order?: number }
 *
 * Upserts the per-product override / featured / sort_order for the Ellbow
 * RoadTour catalog. Does NOT modify the Product Master product. Vape products
 * cannot be included (also enforced by a DB trigger).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await params
    const body = await request.json()
    const ctx = await getRoadtourCatalogContext({ initialize: true })
    const { supabase, organizationId, program, catalog } = ctx

    const { isVape } = await loadOwnedProduct(supabase, productId)

    const payload: Record<string, unknown> = {
      organization_id: organizationId,
      loyalty_program_id: program.id,
      catalog_id: catalog.id,
      product_id: productId,
    }

    if ('visibility_override' in body) {
      const value = body.visibility_override
      if (value === null || value === '') {
        payload.visibility_override = null
      } else if (OVERRIDES.includes(value)) {
        if (value === 'include' && isVape) throw new EllbowApiError('Vape products cannot be included', 422)
        payload.visibility_override = value
      } else {
        throw new EllbowApiError('Invalid visibility_override', 400)
      }
    }
    if ('featured' in body) payload.featured = Boolean(body.featured)
    if ('sort_order' in body) payload.sort_order = nonNegativeInteger(body.sort_order, 'sort_order')

    const { data, error } = await supabase
      .from('roadtour_product_catalog_items')
      .upsert(payload, { onConflict: 'catalog_id,product_id' })
      .select('product_id, visibility_override, featured, sort_order')
      .single()
    if (error) throw error
    return Response.json({ item: data })
  } catch (error) {
    return apiErrorResponse(error)
  }
}

/**
 * DELETE /api/product-catalog/roadtour/products/[productId]
 * Removes the per-product override row entirely, returning the product to its
 * category default. NEVER deletes the Product Master product.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await params
    const ctx = await getRoadtourCatalogContext({ initialize: true })
    const { supabase, organizationId, program, catalog } = ctx
    const { error } = await supabase
      .from('roadtour_product_catalog_items')
      .delete()
      .eq('catalog_id', catalog.id)
      .eq('organization_id', organizationId)
      .eq('loyalty_program_id', program.id)
      .eq('product_id', productId)
    if (error) throw error
    return Response.json({ success: true })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
