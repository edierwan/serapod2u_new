import { NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

const ACTIONS = new Set([
  'select_related_order',
  'carry_forward_related',
  'exclude_and_release',
  'mark_manual_investigation',
])

/**
 * Server-authoritative Opening Balance allocation resolver bridge.
 *
 * All safety (HQ-admin gate, row locking, revalidation, stale-preview rejection,
 * refusal to release while a genuine active order owns the allocation, audit,
 * idempotency) lives in the SECURITY DEFINER RPC
 * `resolve_inventory_cutoff_allocation`. This route only validates the request
 * shape and forwards it under the caller's own session (so `auth.uid()` and
 * `inventory_cutoff_is_hq_admin()` resolve correctly). It performs no writes of
 * its own and never releases an allocation without an explicit user action.
 */
export async function POST(request: Request) {
  const correlationId = request.headers.get('x-request-id') || crypto.randomUUID()
  const headers = { ...noStoreHeaders, 'X-Request-ID': correlationId }

  const context = await getStockConfigAdminContext()
  if (!context.ok) {
    return NextResponse.json({ error: context.error, correlationId }, { status: context.status, headers })
  }

  const body = await request.json().catch(() => null)
  const cutoffId = typeof body?.cutoffId === 'string' ? body.cutoffId : null
  const productVariantId = typeof body?.productVariantId === 'string' ? body.productVariantId : null
  const stockConfigId = typeof body?.stockConfigId === 'string' ? body.stockConfigId : null
  const action = typeof body?.action === 'string' ? body.action : null
  const relatedOrderId = typeof body?.relatedOrderId === 'string' && body.relatedOrderId ? body.relatedOrderId : null
  const reason = typeof body?.reason === 'string' ? body.reason : null
  const expectedAllocated = Number.isFinite(body?.expectedAllocated) ? Math.trunc(body.expectedAllocated) : null
  const expectedSelected = Number.isFinite(body?.expectedSelected) ? Math.trunc(body.expectedSelected) : null
  // Idempotency key is required so a double-submit resolves to one effect.
  const idempotencyKey = typeof body?.idempotencyKey === 'string' && body.idempotencyKey
    ? body.idempotencyKey
    : crypto.randomUUID()

  if (!cutoffId || !productVariantId || !stockConfigId) {
    return NextResponse.json(
      { error: 'cutoffId, productVariantId and stockConfigId are required.', correlationId },
      { status: 400, headers },
    )
  }
  if (!action || !ACTIONS.has(action)) {
    return NextResponse.json(
      { error: 'A valid allocation resolver action is required.', correlationId },
      { status: 400, headers },
    )
  }
  if ((action === 'select_related_order' || action === 'carry_forward_related') && !relatedOrderId) {
    return NextResponse.json(
      { error: 'A related order is required for this action.', correlationId },
      { status: 400, headers },
    )
  }
  if ((action === 'exclude_and_release' || action === 'mark_manual_investigation') && !reason?.trim()) {
    return NextResponse.json(
      { error: 'A reason is required for this action.', correlationId },
      { status: 400, headers },
    )
  }

  // User-context client: the RPC enforces HQ-admin via auth.uid().
  const { data, error } = await context.supabase.rpc('resolve_inventory_cutoff_allocation', {
    p_cutoff_id: cutoffId,
    p_product_variant_id: productVariantId,
    p_stock_config_id: stockConfigId,
    p_action: action,
    p_related_order_id: relatedOrderId,
    p_expected_allocated: expectedAllocated,
    p_expected_selected: expectedSelected,
    p_reason: reason,
    p_idempotency_key: idempotencyKey,
  })

  if (error) {
    const message = String(error.message || '')
    // Surface the resolver's precise, structured refusals with a 409 so the
    // client can re-fetch the preview rather than treat them as a 500.
    const conflict = message.includes('inventory_cutoff_allocation_active_owner')
      || message.includes('inventory_cutoff_stale_preview')
      || message.includes('inventory_cutoff_allocation_idempotency_conflict')
    console.error('Allocation resolver RPC failed', { correlationId, action, cutoffId, message })
    return NextResponse.json(
      { error: message || 'The allocation resolver could not complete.', correlationId },
      { status: conflict ? 409 : 500, headers },
    )
  }

  return NextResponse.json({ result: data, correlationId }, { headers })
}

export const dynamic = 'force-dynamic'
