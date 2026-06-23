import { apiErrorResponse, EllbowApiError } from '@/lib/server/ellbow-catalog'
import { getRoadtourCatalogContext, type InclusionMode } from '@/lib/server/roadtour-catalog'

const MODES: InclusionMode[] = ['include_all', 'selected_only', 'excluded']

/**
 * PATCH /api/product-catalog/roadtour/category-rules
 * Body: { product_category_id, inclusion_mode }
 *
 * Sets the inclusion mode for one category in the Ellbow RoadTour catalog.
 * Vape categories are locked to 'excluded' (also enforced by a DB trigger).
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const productCategoryId = String(body.product_category_id ?? '')
    const mode = String(body.inclusion_mode ?? '') as InclusionMode
    if (!productCategoryId) throw new EllbowApiError('product_category_id is required', 400)
    if (!MODES.includes(mode)) throw new EllbowApiError('Invalid inclusion_mode', 400)

    const ctx = await getRoadtourCatalogContext({ initialize: true })
    const { supabase, organizationId, program, catalog } = ctx

    // Reject changing a Vape category to anything other than excluded.
    const { data: category, error: catError } = await supabase
      .from('product_categories').select('id, is_vape').eq('id', productCategoryId).maybeSingle()
    if (catError) throw catError
    if (!category) throw new EllbowApiError('Category not found', 404)
    if (category.is_vape === true && mode !== 'excluded') {
      throw new EllbowApiError('Vape categories must remain excluded', 422)
    }

    const { data, error } = await supabase
      .from('roadtour_product_category_rules')
      .upsert({
        organization_id: organizationId,
        loyalty_program_id: program.id,
        catalog_id: catalog.id,
        product_category_id: productCategoryId,
        inclusion_mode: mode,
      }, { onConflict: 'catalog_id,product_category_id' })
      .select('product_category_id, inclusion_mode')
      .single()
    if (error) throw error
    return Response.json({ rule: data })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
