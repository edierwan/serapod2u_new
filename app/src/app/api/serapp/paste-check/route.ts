import { NextResponse } from 'next/server'
import { parseSerappLineResolutions, runSerappPasteCheck } from '@/lib/serapp/line-resolutions'
import { loadSerappCatalog, resolveSerappDistributorContext } from '@/lib/serapp/order-context'

/**
 * Serapp Paste & Check — READ ONLY.
 * Never creates an order, allocates stock, or notifies the warehouse.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const pasteText = typeof body?.pasteText === 'string' ? body.pasteText : ''
    if (!pasteText.trim()) {
      return NextResponse.json({ error: 'Paste an order list before checking.' }, { status: 400 })
    }

    const ctx = await resolveSerappDistributorContext({
      distributorId: typeof body?.distributorId === 'string' ? body.distributorId : null,
      fulfillmentWarehouseId: typeof body?.fulfillmentWarehouseId === 'string'
        ? body.fulfillmentWarehouseId
        : null,
    })

    const catalog = await loadSerappCatalog(ctx)
    const resolutions = parseSerappLineResolutions(body?.lineResolutions)
    const checked = runSerappPasteCheck(pasteText, catalog.variants, resolutions)

    return NextResponse.json({
      sideEffects: 'none',
      note: 'Paste & Check is temporary validation only. No order, allocation, or warehouse notification was created.',
      distributor: {
        id: ctx.distributorId,
        org_name: ctx.distributorName,
      },
      fulfillmentWarehouse: {
        id: catalog.inventoryOrganizationId,
        name: catalog.fulfillmentWarehouseName,
      },
      summary: checked.summary,
      results: checked.results,
      estimatedOrderValue: checked.estimatedOrderValue,
    })
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number'
      ? (error as { status: number }).status
      : 500
    const message = error instanceof Error ? error.message : 'Paste & Check failed.'
    console.error('[serapp/paste-check]', error)
    return NextResponse.json({ error: message }, { status })
  }
}

export const dynamic = 'force-dynamic'
