import { NextResponse } from 'next/server'
import { matchPastedOrder } from '@/components/orders/quick-order-matcher'
import { summarizeSerappPasteCheck } from '@/lib/serapp/paste-check-summary'
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
    const results = matchPastedOrder(pasteText, catalog.variants)
    const summary = summarizeSerappPasteCheck(results)

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
      summary,
      results,
      estimatedOrderValue: results.reduce((sum, result) => {
        if (!result.selectedVariantId || !result.quantity || result.quantity <= 0) return sum
        if (result.status !== 'matched' && result.status !== 'alternative_match') return sum
        if (result.inventoryOutcome && result.inventoryOutcome !== 'matched') return sum
        const variant = catalog.variants.find(item => item.id === result.selectedVariantId)
        return sum + (result.quantity * (variant?.distributor_price || 0))
      }, 0),
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
