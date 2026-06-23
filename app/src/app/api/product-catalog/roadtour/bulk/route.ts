import { apiErrorResponse, EllbowApiError } from '@/lib/server/ellbow-catalog'
import { getRoadtourCatalogContext } from '@/lib/server/roadtour-catalog'

type BulkAction = 'include' | 'exclude' | 'remove_override' | 'feature' | 'unfeature'
const ACTIONS: BulkAction[] = ['include', 'exclude', 'remove_override', 'feature', 'unfeature']

/**
 * POST /api/product-catalog/roadtour/bulk
 * Body: { action, product_ids: string[] }
 *
 * Applies a bulk override/featured change to many products at once. Never
 * touches Product Master rows. Vape products are silently skipped for 'include'.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const action = String(body.action ?? '') as BulkAction
    const productIds: string[] = Array.isArray(body.product_ids) ? body.product_ids.map(String) : []
    if (!ACTIONS.includes(action)) throw new EllbowApiError('Invalid action', 400)
    if (productIds.length === 0) throw new EllbowApiError('product_ids is required', 400)
    if (productIds.length > 500) throw new EllbowApiError('Too many products in one request', 400)

    const ctx = await getRoadtourCatalogContext({ initialize: true })
    const { supabase, organizationId, program, catalog } = ctx

    // Resolve which of the requested products are Vape (never includable).
    const { data: products, error: productError } = await supabase
      .from('products')
      .select('id, is_vape, product_categories ( is_vape )')
      .in('id', productIds)
    if (productError) throw productError
    const isVape = (p: any) => {
      const c = Array.isArray(p.product_categories) ? p.product_categories[0] : p.product_categories
      return p.is_vape === true || c?.is_vape === true
    }
    const ownedIds = new Set((products ?? []).map((p: any) => p.id))
    const vapeIds = new Set((products ?? []).filter(isVape).map((p: any) => p.id))
    const targetIds = productIds.filter((id) => ownedIds.has(id))
    if (targetIds.length === 0) throw new EllbowApiError('No matching products', 404)

    const base = (productId: string) => ({
      organization_id: organizationId,
      loyalty_program_id: program.id,
      catalog_id: catalog.id,
      product_id: productId,
    })

    let skipped = 0

    if (action === 'remove_override') {
      const { error } = await supabase
        .from('roadtour_product_catalog_items')
        .delete()
        .eq('catalog_id', catalog.id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id)
        .in('product_id', targetIds)
      if (error) throw error
    } else {
      let rows: any[]
      if (action === 'include') {
        const includable = targetIds.filter((id) => !vapeIds.has(id))
        skipped = targetIds.length - includable.length
        if (includable.length === 0) throw new EllbowApiError('Selected products cannot be included (Vape is excluded)', 422)
        rows = includable.map((id) => ({ ...base(id), visibility_override: 'include' }))
      } else if (action === 'exclude') {
        rows = targetIds.map((id) => ({ ...base(id), visibility_override: 'exclude' }))
      } else {
        // feature / unfeature
        rows = targetIds.map((id) => ({ ...base(id), featured: action === 'feature' }))
      }
      const { error } = await supabase
        .from('roadtour_product_catalog_items')
        .upsert(rows, { onConflict: 'catalog_id,product_id' })
      if (error) throw error
    }

    return Response.json({ success: true, affected: targetIds.length - (action === 'include' ? skipped : 0), skipped })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
