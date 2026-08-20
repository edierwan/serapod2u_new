import {
  resolveCatalogMatch,
  SECTION_PRODUCT_LINES,
  type SectionProductLine,
} from '@/components/orders/quick-order-matcher'
import type { QuickOrderCatalogVariant } from '@/lib/orders/quick-order-catalog'
import { normalizeAlternativeName } from '@/lib/products/alternative-name'
import { loadSerappCatalog, resolveSerappDistributorContext } from '@/lib/serapp/order-context'

const PRODUCT_LINES = new Set<string>(Object.values(SECTION_PRODUCT_LINES))
const DEFAULT_LIMIT = 12

function scoreCatalogVariant(query: string, variant: QuickOrderCatalogVariant): number {
  const q = query.trim().toUpperCase()
  if (!q) return 0

  const code = (variant.product_code || '').toUpperCase()
  const alt = normalizeAlternativeName(variant.alternative_name).toUpperCase()
  const variantName = variant.variant_name.toUpperCase()
  const productName = variant.product_name.toUpperCase()

  if (code === q) return 1000
  if (code.startsWith(q)) return 900 - Math.min(code.length - q.length, 50)
  if (alt === q) return 850
  if (alt.startsWith(q)) return 820
  if (variantName.startsWith(q)) return 780
  if (productName.startsWith(q)) return 740

  const tokens = `${productName} ${variantName} ${alt}`.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (tokens.some((token) => token.startsWith(q))) return 680

  if (variantName.includes(q)) return 520
  if (productName.includes(q)) return 480
  if (alt.includes(q)) return 440
  if (code.includes(q)) return 400

  return 0
}

function mapVariantRow(variant: QuickOrderCatalogVariant): SerappCatalogSearchVariant {
  return {
    id: variant.id,
    product_id: variant.product_id,
    product_name: variant.product_name,
    product_code: variant.product_code,
    group_name: variant.group_name ?? null,
    variant_name: variant.variant_name,
    alternative_name: variant.alternative_name ?? null,
    available_qty: variant.available_qty,
    inventory_classification: variant.inventory_classification,
  }
}

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
  limit?: number
}): Promise<{ variants: SerappCatalogSearchVariant[] }> {
  const query = input.query.trim()
  if (query.length < 1) return { variants: [] }
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), 24)

  const sectionRaw = typeof input.sectionProductLine === 'string' ? input.sectionProductLine : null
  const sectionProductLine = sectionRaw && PRODUCT_LINES.has(sectionRaw)
    ? sectionRaw as SectionProductLine
    : undefined

  const ctx = await resolveSerappDistributorContext({
    distributorId: input.distributorId || null,
    fulfillmentWarehouseId: input.fulfillmentWarehouseId || null,
  })

  const catalog = await loadSerappCatalog(ctx)
  const byId = new Map(catalog.variants.map((variant) => [variant.id, variant]))
  const seen = new Set<string>()
  const ranked: SerappCatalogSearchVariant[] = []

  const pushVariant = (variant: QuickOrderCatalogVariant | undefined) => {
    if (!variant || seen.has(variant.id)) return
    seen.add(variant.id)
    ranked.push(mapVariantRow(variant))
  }

  if (query.length >= 2) {
    const resolved = resolveCatalogMatch(query, catalog.variants, sectionProductLine)
    resolved.candidates.forEach((candidate) => pushVariant(byId.get(candidate.id)))
  }

  catalog.variants
    .map((variant) => ({ variant, score: scoreCatalogVariant(query, variant) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || left.variant.product_name.localeCompare(right.variant.product_name)
      || left.variant.variant_name.localeCompare(right.variant.variant_name)
    ))
    .forEach(({ variant }) => pushVariant(variant))

  return { variants: ranked.slice(0, limit) }
}
