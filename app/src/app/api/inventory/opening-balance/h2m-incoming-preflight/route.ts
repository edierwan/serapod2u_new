import { NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'
import type {
  H2mIncomingEligibilityMap,
} from '@/lib/inventory/opening-balance-h2m-preflight'
import {
  categorizeH2mPreflightError,
  parseH2mResolverResponse,
  type H2mPreflightErrorCategory,
} from '@/lib/inventory/opening-balance-h2m-preflight-server'

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }
const resolverName = 'resolve_inventory_cutoff_h2m_incoming'

const errorResponse = (
  category: H2mPreflightErrorCategory,
  error: string,
  correlationId: string,
  status: number,
) => NextResponse.json(
  { category, error, correlationId },
  { status, headers: { ...noStoreHeaders, 'X-Request-ID': correlationId } },
)

export async function POST(request: Request) {
  const correlationId = request.headers.get('x-request-id') || crypto.randomUUID()
  const context = await getStockConfigAdminContext()
  if (!context.ok) {
    const category: H2mPreflightErrorCategory = context.status === 401 || context.status === 403
      ? 'h2m_preflight_unauthorized'
      : 'h2m_preflight_failed'
    console.error('H2M preflight request rejected', {
      route: '/api/inventory/opening-balance/h2m-incoming-preflight',
      function: resolverName,
      errorCode: context.error,
      cutoffId: null,
      correlationId,
      category,
    })
    return errorResponse(
      category,
      category === 'h2m_preflight_unauthorized'
        ? 'Your session is not authorized to run the H2M readiness check.'
        : 'The H2M readiness check could not start.',
      correlationId,
      context.status,
    )
  }

  const body = await request.json().catch(() => null)
  const cutoffId = typeof body?.cutoffId === 'string' ? body.cutoffId : null
  const rawOrderItemIds: unknown[] = Array.isArray(body?.orderItemIds)
    ? body.orderItemIds
    : []
  const orderItemIds = Array.from(new Set(
    rawOrderItemIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    ),
  ))

  if (!cutoffId) {
    return errorResponse(
      'h2m_cutoff_not_ready',
      'An active Opening Balance cutoff is required before checking H2M readiness.',
      correlationId,
      409,
    )
  }
  if (orderItemIds.length === 0) {
    return NextResponse.json(
      { eligibility: {} as H2mIncomingEligibilityMap },
      { headers: { ...noStoreHeaders, 'X-Request-ID': correlationId } },
    )
  }

  const { data, error } = await context.admin.rpc(
    resolverName,
    { p_cutoff_id: cutoffId, p_order_item_ids: orderItemIds },
  )
  if (error) {
    const failure = categorizeH2mPreflightError(error)
    console.error('H2M authoritative preflight failed', {
      route: '/api/inventory/opening-balance/h2m-incoming-preflight',
      function: resolverName,
      errorCode: failure.errorCode,
      cutoffId,
      correlationId,
      category: failure.category,
    })
    return errorResponse(
      failure.category,
      failure.userMessage,
      correlationId,
      failure.status,
    )
  }

  let eligibility: H2mIncomingEligibilityMap
  try {
    eligibility = parseH2mResolverResponse(data, orderItemIds)
  } catch {
    const category: H2mPreflightErrorCategory = 'h2m_preflight_invalid_response'
    console.error('H2M authoritative preflight returned an invalid response', {
      route: '/api/inventory/opening-balance/h2m-incoming-preflight',
      function: resolverName,
      errorCode: 'invalid_response',
      cutoffId,
      correlationId,
      category,
    })
    return errorResponse(
      category,
      'The H2M readiness service returned an invalid response. Retry the check.',
      correlationId,
      502,
    )
  }

  return NextResponse.json(
    { eligibility, correlationId },
    { headers: { ...noStoreHeaders, 'X-Request-ID': correlationId } },
  )
}

export const dynamic = 'force-dynamic'
