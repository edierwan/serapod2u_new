import { NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'
import {
  H2M_BULK_MIGRATION,
  H2mBulkInvalidResponseError,
  categorizeH2mBulkError,
  describeH2mBulkRpcResponse,
  normalizeH2mBulkRpcResponse,
  parseH2mBulkSummary,
  serializeH2mBulkSummary,
  type H2mBulkAction,
  type H2mBulkErrorCategory,
} from '@/lib/inventory/opening-balance-h2m-bulk'

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }
const actions = new Set<H2mBulkAction>([
  'selected_incoming',
  'selected_not_incoming',
  'all_remaining_not_incoming',
])

const responseHeaders = (correlationId: string) => ({
  ...noStoreHeaders,
  'X-Request-ID': correlationId,
})

const errorResponse = (
  category: H2mBulkErrorCategory,
  error: string,
  correlationId: string,
  status: number,
) => NextResponse.json(
  { category, error, correlationId, savedDecisionsPreserved: true },
  { status, headers: responseHeaders(correlationId) },
)

export async function POST(request: Request) {
  const correlationId = request.headers.get('x-request-id') || crypto.randomUUID()
  const context = await getStockConfigAdminContext()
  if (!context.ok) {
    const category: H2mBulkErrorCategory =
      context.status === 401 || context.status === 403
        ? 'h2m_bulk_unauthorized'
        : 'h2m_bulk_preflight_failed'
    console.error('H2M bulk request rejected', {
      rpcName: null,
      responseType: null,
      topLevelKeys: [],
      rejectedField: 'authorization',
      expectedType: 'authorized HQ session',
      actualDescription: `HTTP ${context.status}`,
      cutoffId: null,
      requestedAction: null,
      correlationId,
    })
    return errorResponse(
      category,
      category === 'h2m_bulk_unauthorized'
        ? 'Your session is not authorized to run this H2M bulk action.'
        : 'The H2M bulk request could not start.',
      correlationId,
      context.status,
    )
  }

  const body = await request.json().catch(() => null)
  const cutoffId = typeof body?.cutoffId === 'string' ? body.cutoffId : null
  const action = typeof body?.action === 'string' && actions.has(body.action)
    ? body.action as H2mBulkAction
    : null
  const orderIds = Array.isArray(body?.orderIds)
    ? Array.from(new Set(
        body.orderIds.filter(
          (id: unknown): id is string => typeof id === 'string' && id.length > 0,
        ),
      ))
    : []
  const apply = body?.apply === true

  // An empty manual selection is invalid. It must never be reinterpreted as
  // the explicitly separate all-remaining action.
  if (!cutoffId || !action || (action !== 'all_remaining_not_incoming' && orderIds.length === 0)) {
    return errorResponse(
      'h2m_bulk_preflight_failed',
      'A valid cutoff, action, and non-empty manual selection are required.',
      correlationId,
      400,
    )
  }

  const rpcName = apply
    ? 'apply_inventory_cutoff_h2m_bulk'
    : 'inventory_cutoff_h2m_bulk_preflight'
  const args = apply
    ? {
        p_cutoff_id: cutoffId,
        p_action: action,
        p_order_ids: orderIds,
        p_expected_fingerprint:
          typeof body?.confirmationFingerprint === 'string'
            ? body.confirmationFingerprint
            : '',
        p_idempotency_key:
          typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : '',
      }
    : { p_cutoff_id: cutoffId, p_action: action, p_order_ids: orderIds }

  // Apply through the authenticated client so auth.uid() remains the audited
  // decision actor. Read-only preflight may use the admin client after the same
  // explicit HQ authorization check.
  const client = apply ? context.supabase : context.admin
  const { data, error } = await client.rpc(rpcName, args)
  if (error) {
    const failure = categorizeH2mBulkError(error, apply)
    console.error('H2M bulk RPC failed', {
      rpcName,
      responseType: null,
      topLevelKeys: [],
      rejectedField: null,
      expectedType: null,
      actualDescription: `database error code ${failure.errorCode}`,
      cutoffId,
      requestedAction: action,
      correlationId,
    })
    return errorResponse(
      failure.category,
      failure.category === 'h2m_bulk_resolver_unavailable'
        ? `${failure.userMessage} Required migration: ${H2M_BULK_MIGRATION}.`
        : failure.userMessage,
      correlationId,
      failure.status,
    )
  }

  const responseShape = describeH2mBulkRpcResponse(data)
  try {
    const summary = parseH2mBulkSummary(data)
    if (summary.cutoffId !== cutoffId || summary.action !== action) {
      throw new H2mBulkInvalidResponseError(
        summary.cutoffId !== cutoffId ? 'cutoff_id' : 'action',
        'the requested cutoff and action',
        summary.cutoffId !== cutoffId ? summary.cutoffId : summary.action,
      )
    }

    const payload: Record<string, unknown> = serializeH2mBulkSummary(summary)
    if (apply) {
      const rawRow = normalizeH2mBulkRpcResponse(data)
      payload.applied_item_count = summary.eligibleItemCount
      payload.decision = action === 'selected_incoming'
        ? 'carry_forward_incoming'
        : 'history_only'
      payload.idempotent_replay = rawRow.idempotent_replay === true
    }
    return NextResponse.json(payload, {
      headers: responseHeaders(correlationId),
    })
  } catch (error) {
    const details = error instanceof H2mBulkInvalidResponseError
      ? error.details
      : {
          field: '$response',
          expected: 'canonical H2M bulk response',
          actual: 'unexpected parser failure',
        }
    console.error('H2M bulk RPC response rejected', {
      rpcName,
      responseType: responseShape.responseType,
      topLevelKeys: responseShape.topLevelKeys,
      rejectedField: details.field,
      expectedType: details.expected,
      actualDescription: details.actual,
      cutoffId,
      requestedAction: action,
      correlationId,
    })
    return errorResponse(
      'h2m_bulk_invalid_response',
      'H2M bulk check returned an unexpected response. Refresh and retry. No decisions were changed.',
      correlationId,
      502,
    )
  }
}

export const dynamic = 'force-dynamic'
