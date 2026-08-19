import { resolveCatalogMatch, SECTION_PRODUCT_LINES, type SectionProductLine } from '@/components/orders/quick-order-matcher'
import { loadSerappCatalog, resolveSerappDistributorContext } from '@/lib/serapp/order-context'

const PRODUCT_LINES = new Set<string>(Object.values(SECTION_PRODUCT_LINES))

export type SerappCatalogSearchVariant = {
  id: string
  product_id: string
  product_name: string
  product_code: string
  group_name: string | null
  variant_name: string
  alternative_name: string | null
  available_qty: number | null | undefined
  inventory_classification: string | null | undefined
}

export async function searchSerappCatalog(input: {
  query: string
  distributorId?: string | null
  fulfillmentWarehouseId?: string | null
  sectionProductLine?: string | null
}): Promise<{ variants: SerappCatalogSearchVariant[] }> {
  const query = input.query.trim()
  if (query.length < 2) return { variants: [] }

  const sectionRaw = typeof input.sectionProductLine === 'string' ? input.sectionProductLine : null
  const sectionProductLine = sectionRaw && PRODUCT_LINES.has(sectionRaw)
    ? sectionRaw as SectionProductLine
    : undefined

  const ctx = await resolveSerappDistributorContext({
    distributorId: input.distributorId || null,
    fulfillmentWarehouseId: input.fulfillmentWarehouseId || null,
  })

  const catalog = await loadSerappCatalog(ctx)
  const resolved = resolveCatalogMatch(query, catalog.variants, sectionProductLine)
  const byId = new Map(catalog.variants.map((variant) => [variant.id, variant]))

  return {
    variants: resolved.candidates.slice(0, 8).map((candidate) => {
      const variant = byId.get(candidate.id)
      if (!variant) return null
      return {
        id: variant.id,
        product_id: variant.product_id,
        product_name: variant.product_name,
        product_code: variant.product_code,
        group_name: variant.group_name,
        variant_name: variant.variant_name,
        alternative_name: variant.alternative_name,
        available_qty: variant.available_qty,
        inventory_classification: variant.inventory_classification,
      }
    }).filter(Boolean) as SerappCatalogSearchVariant[],
  }
}
