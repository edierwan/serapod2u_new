import { apiErrorResponse } from '@/lib/server/ellbow-catalog'
import {
  getRoadtourCatalogContext,
  loadAssortment,
  classifyCategory,
  defaultInclusionMode,
  sortAssortment,
  type InclusionMode,
  type CategoryRow,
} from '@/lib/server/roadtour-catalog'

/**
 * GET /api/product-catalog/roadtour/catalog
 *
 * Returns everything the RoadTour Catalog admin page needs for the Ellbow
 * program: program state, catalog, category rules (joined with Product Master
 * category metadata), the full product assortment with effective visibility, and
 * the summary card counts. Idempotently initializes the catalog + default rules.
 */
export async function GET() {
  try {
    const ctx = await getRoadtourCatalogContext({ initialize: true })
    const { supabase, organizationId, program, catalog } = ctx

    const [assortment, { data: categories, error: catError }, { data: rules, error: ruleError }] = await Promise.all([
      loadAssortment(ctx),
      supabase.from('product_categories').select('id, category_code, category_name, is_vape, is_active'),
      supabase.from('roadtour_product_category_rules')
        .select('product_category_id, inclusion_mode')
        .eq('catalog_id', catalog.id).eq('organization_id', organizationId).eq('loyalty_program_id', program.id),
    ])
    if (catError) throw catError
    if (ruleError) throw ruleError

    const modeByCategory = new Map<string, InclusionMode>(
      (rules ?? []).map((r: any) => [r.product_category_id, r.inclusion_mode as InclusionMode]),
    )

    // Per-category active-product counts (from the assortment we already loaded).
    const activeCountByCategory = new Map<string, number>()
    for (const row of assortment) {
      if (row.is_active && row.category_id) {
        activeCountByCategory.set(row.category_id, (activeCountByCategory.get(row.category_id) ?? 0) + 1)
      }
    }

    const categoryRules = (categories ?? [])
      .filter((c: CategoryRow) => c.is_active !== false)
      .map((c: CategoryRow) => {
        const kind = classifyCategory(c)
        return {
          product_category_id: c.id,
          category_code: c.category_code,
          category_name: (c.category_name || '').trim(),
          is_vape: c.is_vape === true,
          kind,
          // Vape is locked to excluded in this phase.
          locked: kind === 'vape',
          inclusion_mode: modeByCategory.get(c.id) ?? defaultInclusionMode(c),
          active_product_count: activeCountByCategory.get(c.id) ?? 0,
        }
      })
      .sort((a: any, b: any) => a.category_name.localeCompare(b.category_name))

    const sorted = sortAssortment(assortment)
    const includedCount = sorted.filter((r) => r.effective_included).length
    const autoIncludedPetFood = sorted.filter(
      (r) => r.effective_included && r.visibility_source === 'category' && r.category_id && modeByCategory.get(r.category_id) === 'include_all',
    ).length
    const excludedCount = sorted.filter((r) => !r.effective_included).length

    return Response.json({
      program: { id: program.id, name: program.name, active: program.active },
      catalog: { id: catalog.id, code: catalog.code, name: catalog.name, active: catalog.active },
      categoryRules,
      products: sorted,
      summary: {
        totalProducts: sorted.length,
        includedCount,
        autoIncludedPetFood,
        excludedCount,
      },
    })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
