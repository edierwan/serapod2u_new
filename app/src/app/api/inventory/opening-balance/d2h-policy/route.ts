import { NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'
import {
  D2H_POLICY_MIGRATION,
  D2hPolicyInvalidResponseError,
  categorizeD2hPolicyError,
  normalizeD2hPolicyRpcResponse,
  parseD2hPolicySummary,
  serializeD2hPolicySummary,
  type D2hPolicy,
  type D2hPolicyErrorCategory,
} from '@/lib/inventory/opening-balance-d2h-policy'

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }
const policies = new Set<D2hPolicy>(['exclude_all', 'review_select'])

const responseHeaders = (correlationId: string) => ({
  ...noStoreHeaders,
  'X-Request-ID': correlationId,
})

const errorResponse = (
  category: D2hPolicyErrorCategory,
  error: string,
  correlationId: string,
  status: number,
) => NextResponse.json(
  {
    category,
    error,
    correlationId,
    savedDecisionsPreserved: true,
    cutoffCancelled: false,
    migration: D2H_POLICY_MIGRATION,
  },
  { status, headers: responseHeaders(correlationId) },
)

export async function POST(request: Request) {
  const correlationId = request.headers.get('x-request-id') || crypto.randomUUID()
  const context = await getStockConfigAdminContext()
  if (!context.ok) {
    const category: D2hPolicyErrorCategory =
      context.status === 401 || context.status === 403
        ? 'd2h_policy_unauthorized'
        : 'd2h_policy_preflight_failed'
    return errorResponse(
      category,
      category === 'd2h_policy_unauthorized'
        ? 'Your session is not authorized to save a D2H policy.'
        : 'The D2H policy request could not start.',
      correlationId,
      context.status,
    )
  }

  const body = await request.json().catch(() => null)
  const cutoffId = typeof body?.cutoffId === 'string' ? body.cutoffId : null
  const policy = typeof body?.policy === 'string' && policies.has(body.policy)
    ? body.policy as D2hPolicy
    : null
  const orderIds = Array.isArray(body?.orderIds)
    ? Array.from(new Set(
        body.orderIds.filter(
          (id: unknown): id is string => typeof id === 'string' && id.length > 0,
        ),
      ))
    : []
  const apply = body?.apply === true

  if (!cutoffId || !policy) {
    return errorResponse(
      'd2h_policy_preflight_failed',
      'A valid cutoff and D2H policy are required.',
      correlationId,
      400,
    )
  }

  if (policy === 'review_select' && apply && orderIds.some(id => typeof id !== 'string')) {
    return errorResponse(
      'd2h_policy_preflight_failed',
      'Selected order ids must be valid UUIDs.',
      correlationId,
      400,
    )
  }

  const rpcName = apply
    ? 'apply_inventory_cutoff_d2h_policy'
    : 'inventory_cutoff_d2h_policy_preflight'
  const args = apply
    ? {
        p_cutoff_id: cutoffId,
        p_policy: policy,
        p_selected_order_ids: orderIds,
        p_expected_fingerprint:
          typeof body?.confirmationFingerprint === 'string'
            ? body.confirmationFingerprint
            : '',
        p_idempotency_key:
          typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : '',
      }
    : {
        p_cutoff_id: cutoffId,
        p_policy: policy,
        p_selected_order_ids: orderIds,
      }

  // Apply through the authenticated client so auth.uid() remains the audited
  // decision actor. Read-only preflight may use the admin client after the same
  // explicit HQ authorization check.
  const client = apply ? context.supabase : context.admin
  const { data, error } = await client.rpc(rpcName, args)
  if (error) {
    const failure = categorizeD2hPolicyError(error, apply)
    console.error('D2H policy RPC failed', {
      rpcName,
      cutoffId,
      policy,
      correlationId,
      errorCode: failure.errorCode,
      category: failure.category,
    })
    return errorResponse(failure.category, failure.userMessage, correlationId, failure.status)
  }

  try {
    const summary = parseD2hPolicySummary(normalizeD2hPolicyRpcResponse(data))
    return NextResponse.json(
      {
        ...serializeD2hPolicySummary(summary),
        correlationId,
        cutoffCancelled: false,
        qrImpact: 'none',
      },
      { headers: responseHeaders(correlationId) },
    )
  } catch (parseError) {
    if (parseError instanceof D2hPolicyInvalidResponseError) {
      console.error('D2H policy response rejected', {
        rpcName,
        cutoffId,
        policy,
        correlationId,
        field: parseError.details.field,
        expected: parseError.details.expected,
        actual: parseError.details.actual,
      })
      return errorResponse(
        'd2h_policy_invalid_response',
        'The D2H policy response was invalid. No Opening Balance was cancelled.',
        correlationId,
        502,
      )
    }
    throw parseError
  }
}
