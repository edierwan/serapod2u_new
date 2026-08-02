import { NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'
import {
  TRANSACTIONS_POLICY_MIGRATION,
  TransactionsPolicyInvalidResponseError,
  categorizeTransactionsPolicyError,
  normalizeTransactionsPolicyRpcResponse,
  parseTransactionsPolicySummary,
  serializeCarriedRefs,
  serializeTransactionsPolicySummary,
  type TransactionRef,
  type TransactionType,
  type TransactionsPolicy,
  type TransactionsPolicyErrorCategory,
} from '@/lib/inventory/opening-balance-transactions-policy'

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }
const policies = new Set<TransactionsPolicy>([
  'exclude_all',
  'carry_forward_all',
  'review_select',
])
const transactionTypes = new Set<TransactionType>([
  'stock_adjustment',
  'return',
  'stock_transfer',
])

const responseHeaders = (correlationId: string) => ({
  ...noStoreHeaders,
  'X-Request-ID': correlationId,
})

const errorResponse = (
  category: TransactionsPolicyErrorCategory,
  error: string,
  correlationId: string,
  status: number,
) =>
  NextResponse.json(
    {
      category,
      error,
      correlationId,
      savedPolicyPreserved: true,
      cutoffCancelled: false,
      migration: TRANSACTIONS_POLICY_MIGRATION,
    },
    { status, headers: responseHeaders(correlationId) },
  )

const parseCarriedRefs = (value: unknown): TransactionRef[] => {
  if (!Array.isArray(value)) return []
  const refs: TransactionRef[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const type = row.type
    const id = row.id
    if (typeof type === 'string' && transactionTypes.has(type as TransactionType)
      && typeof id === 'string' && id.length > 0) {
      refs.push({ type: type as TransactionType, id })
    }
  }
  return refs
}

export async function POST(request: Request) {
  const correlationId = request.headers.get('x-request-id') || crypto.randomUUID()
  const context = await getStockConfigAdminContext()
  if (!context.ok) {
    const category: TransactionsPolicyErrorCategory =
      context.status === 401 || context.status === 403
        ? 'transactions_policy_unauthorized'
        : 'transactions_policy_preflight_failed'
    return errorResponse(
      category,
      category === 'transactions_policy_unauthorized'
        ? 'Your session is not authorized to save a Transactions policy.'
        : 'The Transactions policy request could not start.',
      correlationId,
      context.status,
    )
  }

  const body = await request.json().catch(() => null)
  const cutoffId = typeof body?.cutoffId === 'string' ? body.cutoffId : null
  const policy = typeof body?.policy === 'string' && policies.has(body.policy)
    ? (body.policy as TransactionsPolicy)
    : null
  const carriedRefs = serializeCarriedRefs(parseCarriedRefs(body?.carriedRefs))
  const apply = body?.apply === true

  if (!cutoffId || !policy) {
    return errorResponse(
      'transactions_policy_preflight_failed',
      'A valid cutoff and Transactions policy are required.',
      correlationId,
      400,
    )
  }

  const rpcName = apply
    ? 'apply_inventory_cutoff_transactions_policy'
    : 'inventory_cutoff_transactions_policy_preflight'
  const args = apply
    ? {
        p_cutoff_id: cutoffId,
        p_policy: policy,
        p_carried_refs: carriedRefs,
        p_expected_fingerprint:
          typeof body?.confirmationFingerprint === 'string' ? body.confirmationFingerprint : '',
        p_idempotency_key: typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : '',
      }
    : {
        p_cutoff_id: cutoffId,
        p_policy: policy,
        p_carried_refs: carriedRefs,
      }

  // Apply through the authenticated client so auth.uid() remains the audited
  // decision actor. Read-only preflight may use the admin client after the same
  // explicit HQ authorization check.
  const client = apply ? context.supabase : context.admin
  const { data, error } = await client.rpc(rpcName, args)
  if (error) {
    const failure = categorizeTransactionsPolicyError(error, apply)
    console.error('Transactions policy RPC failed', {
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
    const summary = parseTransactionsPolicySummary(normalizeTransactionsPolicyRpcResponse(data))
    return NextResponse.json(
      {
        ...serializeTransactionsPolicySummary(summary),
        correlationId,
        cutoffCancelled: false,
        qrImpact: 'none',
      },
      { headers: responseHeaders(correlationId) },
    )
  } catch (parseError) {
    if (parseError instanceof TransactionsPolicyInvalidResponseError) {
      console.error('Transactions policy response rejected', {
        rpcName,
        cutoffId,
        policy,
        correlationId,
        field: parseError.details.field,
        expected: parseError.details.expected,
        actual: parseError.details.actual,
      })
      return errorResponse(
        'transactions_policy_invalid_response',
        'The Transactions policy response was invalid. No Opening Balance was cancelled.',
        correlationId,
        502,
      )
    }
    throw parseError
  }
}
