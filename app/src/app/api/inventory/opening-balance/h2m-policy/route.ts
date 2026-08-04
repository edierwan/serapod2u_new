import { NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'
import {
  H2M_POLICY_MIGRATION,
  H2mPolicyInvalidResponseError,
  categorizeH2mPolicyError,
  normalizeH2mPolicyRpcResponse,
  parseH2mPolicySummary,
  serializeH2mPolicySummary,
  type H2mPolicy,
  type H2mPolicyErrorCategory,
} from '@/lib/inventory/opening-balance-h2m-policy'

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }
const policies = new Set<H2mPolicy>(['exclude_all', 'review_select'])

const responseHeaders = (correlationId: string) => ({
  ...noStoreHeaders,
  'X-Request-ID': correlationId,
})

const errorResponse = (
  category: H2mPolicyErrorCategory,
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
    inventoryAdded: false,
    qrImpact: 'none',
    migration: H2M_POLICY_MIGRATION,
  },
  { status, headers: responseHeaders(correlationId) },
)

export async function POST(request: Request) {
  const correlationId = request.headers.get('x-request-id') || crypto.randomUUID()
  const context = await getStockConfigAdminContext()
  if (!context.ok) {
    const category: H2mPolicyErrorCategory =
      context.status === 401 || context.status === 403
        ? 'h2m_policy_unauthorized'
        : 'h2m_policy_preflight_failed'
    return errorResponse(
      category,
      category === 'h2m_policy_unauthorized'
        ? 'Your session is not authorized to save an H2M policy.'
        : 'The H2M policy request could not start.',
      correlationId,
      context.status,
    )
  }

  const body = await request.json().catch(() => null)
  const cutoffId = typeof body?.cutoffId === 'string' ? body.cutoffId : null
  const policy = typeof body?.policy === 'string' && policies.has(body.policy)
    ? body.policy as H2mPolicy
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
      'h2m_policy_preflight_failed',
      'A valid cutoff and H2M policy are required.',
      correlationId,
      400,
    )
  }

  if (policy === 'review_select' && apply && orderIds.some(id => typeof id !== 'string')) {
    return errorResponse(
      'h2m_policy_preflight_failed',
      'Selected order ids must be valid UUIDs.',
      correlationId,
      400,
    )
  }

  const rpcName = apply
    ? 'apply_inventory_cutoff_h2m_policy'
    : 'inventory_cutoff_h2m_policy_preflight'
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

  const client = apply ? context.supabase : context.admin
  const { data, error } = await client.rpc(rpcName, args)
  if (error) {
    const failure = categorizeH2mPolicyError(error, apply)
    console.error('H2M policy RPC failed', {
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
    const summary = parseH2mPolicySummary(normalizeH2mPolicyRpcResponse(data))
    return NextResponse.json(
      {
        ...serializeH2mPolicySummary(summary),
        correlationId,
        cutoffCancelled: false,
        inventoryAdded: false,
        qrImpact: 'none',
      },
      { headers: responseHeaders(correlationId) },
    )
  } catch (parseError) {
    if (parseError instanceof H2mPolicyInvalidResponseError) {
      console.error('H2M policy response rejected', {
        rpcName,
        cutoffId,
        policy,
        correlationId,
        field: parseError.details.field,
        expected: parseError.details.expected,
        actual: parseError.details.actual,
      })
      return errorResponse(
        'h2m_policy_invalid_response',
        'The H2M policy response was invalid. No Opening Balance was cancelled.',
        correlationId,
        502,
      )
    }
    throw parseError
  }
}

export const dynamic = 'force-dynamic'
