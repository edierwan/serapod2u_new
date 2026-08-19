import { NextResponse } from 'next/server'
import { resolveCatalogMatch, SECTION_PRODUCT_LINES, type SectionProductLine } from '@/components/orders/quick-order-matcher'
import { loadSerappCatalog, resolveSerappDistributorContext } from '@/lib/serapp/order-context'

const PRODUCT_LINES = new Set<string>(Object.values(SECTION_PRODUCT_LINES))

/**
 * Search the same Quick Order catalog used by Paste & Check.
 * Read-only. Used to fix not-found lines against real Master Data.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const query = typeof body?.query === 'string' ? body.query.trim() : ''
    if (query.length < 2) {
      return NextResponse.json({ variants: [] })
    }

    const sectionRaw = typeof body?.sectionProductLine === 'string' ? body.sectionProductLine : null
    const sectionProductLine = sectionRaw && PRODUCT_LINES.has(sectionRaw)
      ? sectionRaw as SectionProductLine
      : undefined

    const ctx = await resolveSerappDistributorContext({
      distributorId: typeof body?.distributorId === 'string' ? body.distributorId : null,
      fulfillmentWarehouseId: typeof body?.fulfillmentWarehouseId === 'string'
        ? body.fulfillmentWarehouseId
        : null,
    })

    const catalog = await loadSerappCatalog(ctx)
    const resolved = resolveCatalogMatch(query, catalog.variants, sectionProductLine)
    const byId = new Map(catalog.variants.map(variant => [variant.id, variant]))

    return NextResponse.json({
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
      }).filter(Boolean),
    })
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number'
      ? (error as { status: number }).status
      : 500
    const message = error instanceof Error ? error.message : 'Catalog search failed.'
    console.error('[serapp/catalog-search]', error)
    return NextResponse.json({ error: message }, { status })
  }
}

export const dynamic = 'force-dynamic'
