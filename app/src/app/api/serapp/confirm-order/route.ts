import { NextResponse } from 'next/server'
import { runSerappConfirmOrder } from '@/lib/serapp/assistant-actions'

/**
 * Serapp Confirm Order
 *
 * 1) Re-parse + re-check stock
 * 2) Create D2H order via current `submit_and_allocate_d2h_order` (allocate on submit)
 * 3) Register a 1-hour Serapp hold window for warehouse acceptance
 *
 * Non-Serapp Dashboard orders are untouched.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const result = await runSerappConfirmOrder({
      pasteText: typeof body?.pasteText === 'string' ? body.pasteText : '',
      acceptAvailableOnly: body?.acceptAvailableOnly !== false,
      idempotencyKey: typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : null,
      distributorId: typeof body?.distributorId === 'string' ? body.distributorId : null,
      fulfillmentWarehouseId: typeof body?.fulfillmentWarehouseId === 'string'
        ? body.fulfillmentWarehouseId
        : null,
      lineResolutions: body?.lineResolutions,
      quantityResolutions: body?.quantityResolutions,
      request,
    })

    if (!result.ok) {
      return NextResponse.json({
        error: result.error,
        summary: result.summary,
        results: result.results,
        order: result.order,
        hold: result.hold ?? null,
        confirmedLines: result.confirmedLines,
        skippedLines: result.skippedLines,
        estimatedOrderValue: result.estimatedOrderValue,
      }, { status: result.status })
    }

    return NextResponse.json({
      ok: true,
      source: 'Serapp Conversation',
      allocation: 'current_flow_on_submit_with_1h_acceptance_window',
      note: result.note,
      order: result.order,
      hold: result.hold,
      confirmedLines: result.confirmedLines,
      skippedLines: result.skippedLines,
      summary: result.summary,
      fulfillmentWarehouse: result.fulfillmentWarehouse,
      estimatedOrderValue: result.estimatedOrderValue,
    })
  } catch (error) {
    const status = typeof (error as { status?: number })?.status === 'number'
      ? (error as { status: number }).status
      : 500
    const message = error instanceof Error ? error.message : 'Confirm order failed.'
    console.error('[serapp/confirm-order]', error)
    return NextResponse.json({ error: message }, { status })
  }
}

export const dynamic = 'force-dynamic'
