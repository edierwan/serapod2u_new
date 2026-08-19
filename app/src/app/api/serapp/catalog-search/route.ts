import { NextResponse } from 'next/server'
import { searchSerappCatalog } from '@/lib/serapp/catalog-search'

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

    const result = await searchSerappCatalog({
      query,
      distributorId: typeof body?.distributorId === 'string' ? body.distributorId : null,
      fulfillmentWarehouseId: typeof body?.fulfillmentWarehouseId === 'string'
        ? body.fulfillmentWarehouseId
        : null,
      sectionProductLine: typeof body?.sectionProductLine === 'string' ? body.sectionProductLine : null,
    })

    return NextResponse.json(result)
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
