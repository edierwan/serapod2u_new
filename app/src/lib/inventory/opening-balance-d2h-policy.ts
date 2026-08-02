// ============================================================================
// Opening Balance D2H policy — Option A (exclude all) / Option B (review select)
// ----------------------------------------------------------------------------
// Pure helpers + RPC response parsing for the authoritative server D2H policy
// RPCs. Mirrors the H2M bulk contract: preflight → confirm fingerprint → apply.
// Never cancels a cutoff, never trusts client quantities, never touches QR.
// ============================================================================

export type D2hPolicy = 'exclude_all' | 'review_select'

export const D2H_POLICY_MIGRATION =
  '20260731230000_inventory_cutoff_d2h_policy.sql'

export const D2H_POLICY_LABELS: Record<D2hPolicy, string> = {
  exclude_all: 'Start Fresh — Exclude All Existing D2H Orders',
  review_select: 'Review Orders to Carry Into New Inventory',
}

export const D2H_POLICY_DESCRIPTIONS: Record<D2hPolicy, string> = {
  exclude_all:
    'Existing SO orders remain available for reporting, but will not affect the new inventory baseline.',
  review_select:
    'Select specific existing SO orders that should continue under the new inventory.',
}

export type D2hPolicyErrorCategory =
  | 'd2h_policy_resolver_unavailable'
  | 'd2h_policy_unauthorized'
  | 'd2h_policy_invalid_response'
  | 'd2h_policy_preflight_failed'
  | 'd2h_policy_stale_confirmation'

export interface D2hPolicyOrderSummary {
  orderId: string
  orderNumber: string
  status: string
  customer: string
  itemCount: number
  orderedQuantity: number
  treatment: 'select' | 'exclude' | 'blocked'
  blockedReason: string | null
  hasActiveAllocation: boolean
  hasOrderFulfillment: boolean
}

export interface D2hPolicySummary {
  policy: D2hPolicy
  cutoffId: string
  boundaryAt: string
  confirmationFingerprint: string
  warehouseOrganizationId: string
  companyId: string
  productCategoryId: string | null
  productCategoryName: string
  eligibleOrderCount: number
  eligibleItemCount: number
  eligibleQuantity: number
  selectedOrderCount: number
  selectedItemCount: number
  selectedQuantity: number
  excludedOrderCount: number
  excludedItemCount: number
  excludedQuantity: number
  blockedOrderCount: number
  eligibleOrderIds: string[]
  selectedOrderIds: string[]
  excludedOrderIds: string[]
  blockedOrderIds: string[]
  orderSummaries: D2hPolicyOrderSummary[]
  ordersCancelled: false
  historicalMovementsReversed: false
  qrImpact: 'none'
  notice: string
}

export interface D2hPolicySnapshot {
  policy: D2hPolicy
  boundaryAt: string
  warehouseOrganizationId?: string
  companyId?: string
  productCategoryId?: string
  eligibleOrderCount: number
  eligibleItemCount: number
  eligibleQuantity: number
  selectedOrderCount: number
  selectedItemCount: number
  selectedQuantity: number
  excludedOrderCount: number
  excludedItemCount: number
  excludedQuantity: number
  eligibleOrderIds: string[]
  selectedOrderIds: string[]
  excludedOrderIds: string[]
  decidedBy?: string
  decidedAt?: string
  confirmationFingerprint?: string
  ordersCancelled: false
  historicalMovementsReversed: false
  qrImpact: 'none'
}

export interface D2hHistoricalSummary {
  orderCount: number
  itemCount: number
  orderedQuantity: number
  ordersCancelled: false
  historicalStockReturned: false
  notice: string | null
}

export class D2hPolicyInvalidResponseError extends Error {
  readonly details: { field: string; expected: string; actual: string }

  constructor(field: string, expected: string, value: unknown) {
    super('d2h_policy_invalid_response')
    this.name = 'D2hPolicyInvalidResponseError'
    this.details = { field, expected, actual: describeSafeValue(value) }
  }
}

const policies = new Set<D2hPolicy>(['exclude_all', 'review_select'])
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function describeSafeValue(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'missing'
  if (Array.isArray(value)) return `array(length=${value.length})`
  if (typeof value === 'string') return `string(length=${value.length})`
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `number(${value})` : 'number(non-finite)'
  }
  if (typeof value === 'boolean') return `boolean(${value})`
  if (typeof value === 'object') {
    return `object(keys=${Object.keys(value as Record<string, unknown>).sort().join(',')})`
  }
  return typeof value
}

const invalid = (field: string, expected: string, value: unknown): never => {
  throw new D2hPolicyInvalidResponseError(field, expected, value)
}

export function normalizeD2hPolicyRpcResponse(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length !== 1) invalid('$response', 'a single-row array', value)
    const row = value[0]
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      invalid('$response[0]', 'a JSON object', row)
    }
    return row as Record<string, unknown>
  }
  if (!value || typeof value !== 'object') {
    invalid('$response', 'a JSON object or single-row array', value)
  }
  return value as Record<string, unknown>
}

const requiredString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key]
  if (typeof value !== 'string' || value.length === 0) {
    invalid(key, 'a non-empty string', value)
  }
  return value as string
}

const requiredUuid = (row: Record<string, unknown>, key: string): string => {
  const value = requiredString(row, key)
  if (!uuidPattern.test(value)) invalid(key, 'a UUID string', value)
  return value
}

const optionalUuid = (row: Record<string, unknown>, key: string): string | null => {
  const value = row[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    invalid(key, 'a UUID string when present', value)
  }
  return value
}

const requiredCount = (row: Record<string, unknown>, key: string): number => {
  const value = row[key]
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^-?\d+$/.test(value)
      ? Number(value)
      : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    invalid(key, 'a non-negative safe integer or numeric string', value)
  }
  return parsed
}

const requiredUuidArray = (row: Record<string, unknown>, key: string): string[] => {
  const value = row[key]
  if (!Array.isArray(value)) invalid(key, 'a UUID array', value)
  const rejected = value.find(item => typeof item !== 'string' || !uuidPattern.test(item))
  if (rejected !== undefined) invalid(`${key}[]`, 'a UUID string', rejected)
  const strings = value as string[]
  if (new Set(strings).size !== strings.length) invalid(key, 'a unique UUID array', value)
  return strings
}

/**
 * Boundary used for pre-cut-off D2H classification.
 * Before posting: proposed_cutoff_at. After posting: posted_at.
 */
export function d2hCutoffBoundaryAt(input: {
  proposedCutoffAt?: string | null
  postedAt?: string | null
  cutoffBoundaryAt?: string | null
}): string | null {
  return input.cutoffBoundaryAt
    || input.postedAt
    || input.proposedCutoffAt
    || null
}

export function isD2hOrderPreBoundary(
  orderCreatedAt: string | null | undefined,
  boundaryAt: string | null | undefined,
): boolean {
  if (!orderCreatedAt || !boundaryAt) return false
  const created = Date.parse(orderCreatedAt)
  const boundary = Date.parse(boundaryAt)
  if (Number.isNaN(created) || Number.isNaN(boundary)) return false
  return created < boundary
}

export function parseD2hPolicySnapshot(value: unknown): D2hPolicySnapshot | null {
  if (value == null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('d2h_policy', 'a JSON object or null', value)
  }
  const row = value as Record<string, unknown>
  const policy = row.policy
  if (typeof policy !== 'string' || !policies.has(policy as D2hPolicy)) {
    invalid('d2h_policy.policy', 'exclude_all or review_select', policy)
  }
  return {
    policy: policy as D2hPolicy,
    boundaryAt: requiredString(row, 'boundary_at'),
    warehouseOrganizationId: optionalUuid(row, 'warehouse_organization_id') ?? undefined,
    companyId: optionalUuid(row, 'company_id') ?? undefined,
    productCategoryId: optionalUuid(row, 'product_category_id') ?? undefined,
    eligibleOrderCount: requiredCount(row, 'eligible_order_count'),
    eligibleItemCount: requiredCount(row, 'eligible_item_count'),
    eligibleQuantity: requiredCount(row, 'eligible_quantity'),
    selectedOrderCount: requiredCount(row, 'selected_order_count'),
    selectedItemCount: requiredCount(row, 'selected_item_count'),
    selectedQuantity: requiredCount(row, 'selected_quantity'),
    excludedOrderCount: requiredCount(row, 'excluded_order_count'),
    excludedItemCount: requiredCount(row, 'excluded_item_count'),
    excludedQuantity: requiredCount(row, 'excluded_quantity'),
    eligibleOrderIds: requiredUuidArray(row, 'eligible_order_ids'),
    selectedOrderIds: requiredUuidArray(row, 'selected_order_ids'),
    excludedOrderIds: requiredUuidArray(row, 'excluded_order_ids'),
    decidedBy: optionalUuid(row, 'decided_by') ?? undefined,
    decidedAt: typeof row.decided_at === 'string' ? row.decided_at : undefined,
    confirmationFingerprint: typeof row.confirmation_fingerprint === 'string'
      ? row.confirmation_fingerprint
      : undefined,
    ordersCancelled: false,
    historicalMovementsReversed: false,
    qrImpact: 'none',
  }
}

export function parseD2hHistoricalSummary(value: unknown): D2hHistoricalSummary | null {
  if (value == null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('d2h_historical_summary', 'a JSON object or null', value)
  }
  const row = value as Record<string, unknown>
  return {
    orderCount: requiredCount(row, 'order_count'),
    itemCount: requiredCount(row, 'item_count'),
    orderedQuantity: requiredCount(row, 'ordered_quantity'),
    ordersCancelled: false,
    historicalStockReturned: false,
    notice: typeof row.notice === 'string' ? row.notice : null,
  }
}

export function parseD2hPolicySummary(value: unknown): D2hPolicySummary {
  const row = normalizeD2hPolicyRpcResponse(value)
  const policy = row.policy
  if (typeof policy !== 'string' || !policies.has(policy as D2hPolicy)) {
    invalid('policy', 'exclude_all or review_select', policy)
  }

  const orderSummariesRaw = row.order_summaries
  const orderSummaries: D2hPolicyOrderSummary[] = []
  if (orderSummariesRaw !== undefined) {
    if (!Array.isArray(orderSummariesRaw)) {
      invalid('order_summaries', 'an array', orderSummariesRaw)
    }
    for (const item of orderSummariesRaw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        invalid('order_summaries[]', 'a JSON object', item)
      }
      const order = item as Record<string, unknown>
      const treatment = order.treatment
      if (treatment !== 'select' && treatment !== 'exclude' && treatment !== 'blocked') {
        invalid('order_summaries[].treatment', 'select|exclude|blocked', treatment)
      }
      orderSummaries.push({
        orderId: requiredUuid(order, 'order_id'),
        orderNumber: requiredString(order, 'order_number'),
        status: requiredString(order, 'status'),
        customer: typeof order.customer === 'string' ? order.customer : '—',
        itemCount: requiredCount(order, 'item_count'),
        orderedQuantity: requiredCount(order, 'ordered_quantity'),
        treatment,
        blockedReason: typeof order.blocked_reason === 'string' ? order.blocked_reason : null,
        hasActiveAllocation: order.has_active_allocation === true,
        hasOrderFulfillment: order.has_order_fulfillment === true,
      })
    }
  }

  const categoryName = row.product_category_name
  if (categoryName !== undefined && (typeof categoryName !== 'string' || categoryName.length === 0)) {
    invalid('product_category_name', 'a non-empty string when present', categoryName)
  }

  return {
    policy: policy as D2hPolicy,
    cutoffId: requiredUuid(row, 'cutoff_id'),
    boundaryAt: requiredString(row, 'boundary_at'),
    confirmationFingerprint: requiredString(row, 'confirmation_fingerprint'),
    warehouseOrganizationId: requiredUuid(row, 'warehouse_organization_id'),
    companyId: requiredUuid(row, 'company_id'),
    productCategoryId: optionalUuid(row, 'product_category_id'),
    productCategoryName: typeof categoryName === 'string'
      ? categoryName
      : 'the current Opening Balance category',
    eligibleOrderCount: requiredCount(row, 'eligible_order_count'),
    eligibleItemCount: requiredCount(row, 'eligible_item_count'),
    eligibleQuantity: requiredCount(row, 'eligible_quantity'),
    selectedOrderCount: requiredCount(row, 'selected_order_count'),
    selectedItemCount: requiredCount(row, 'selected_item_count'),
    selectedQuantity: requiredCount(row, 'selected_quantity'),
    excludedOrderCount: requiredCount(row, 'excluded_order_count'),
    excludedItemCount: requiredCount(row, 'excluded_item_count'),
    excludedQuantity: requiredCount(row, 'excluded_quantity'),
    blockedOrderCount: requiredCount(row, 'blocked_order_count'),
    eligibleOrderIds: requiredUuidArray(row, 'eligible_order_ids'),
    selectedOrderIds: requiredUuidArray(row, 'selected_order_ids'),
    excludedOrderIds: requiredUuidArray(row, 'excluded_order_ids'),
    blockedOrderIds: requiredUuidArray(row, 'blocked_order_ids'),
    orderSummaries,
    ordersCancelled: false,
    historicalMovementsReversed: false,
    qrImpact: 'none',
    notice: requiredString(row, 'notice'),
  }
}

export function serializeD2hPolicySummary(summary: D2hPolicySummary) {
  return {
    policy: summary.policy,
    cutoff_id: summary.cutoffId,
    boundary_at: summary.boundaryAt,
    confirmation_fingerprint: summary.confirmationFingerprint,
    warehouse_organization_id: summary.warehouseOrganizationId,
    company_id: summary.companyId,
    ...(summary.productCategoryId
      ? { product_category_id: summary.productCategoryId }
      : {}),
    product_category_name: summary.productCategoryName,
    eligible_order_count: summary.eligibleOrderCount,
    eligible_item_count: summary.eligibleItemCount,
    eligible_quantity: summary.eligibleQuantity,
    selected_order_count: summary.selectedOrderCount,
    selected_item_count: summary.selectedItemCount,
    selected_quantity: summary.selectedQuantity,
    excluded_order_count: summary.excludedOrderCount,
    excluded_item_count: summary.excludedItemCount,
    excluded_quantity: summary.excludedQuantity,
    blocked_order_count: summary.blockedOrderCount,
    eligible_order_ids: summary.eligibleOrderIds,
    selected_order_ids: summary.selectedOrderIds,
    excluded_order_ids: summary.excludedOrderIds,
    blocked_order_ids: summary.blockedOrderIds,
    orders_cancelled: false,
    historical_movements_reversed: false,
    qr_impact: 'none',
    notice: summary.notice,
  }
}

/** Step 2 is resolved once a D2H policy snapshot is saved for the cutoff. */
export function isD2hPolicyResolved(policy: D2hPolicySnapshot | null | undefined): boolean {
  return Boolean(policy?.policy)
}

/**
 * Under Option A every pre-boundary D2H order is historical excluded.
 * Under Option B only unselected / explicitly excluded orders are.
 */
export function isD2hOrderHistoricallyExcluded(
  orderId: string | undefined,
  decision: string | null | undefined,
  classification: string | null | undefined,
  policy: D2hPolicySnapshot | null | undefined,
): boolean {
  if (!orderId) return false
  if (classification === 'Historical Excluded' || classification === 'Do Not Carry Forward' || classification === 'History Only') {
    return true
  }
  if (decision === 'do_not_carry_forward') return true
  if (!policy) return false
  if (policy.policy === 'exclude_all') return !policy.selectedOrderIds.includes(orderId)
  return policy.excludedOrderIds.includes(orderId)
}

export function isD2hOrderCarriedForward(
  orderId: string | undefined,
  decision: string | null | undefined,
  policy: D2hPolicySnapshot | null | undefined,
): boolean {
  if (!orderId) return false
  if (decision === 'carry_forward') return true
  if (!policy || policy.policy !== 'review_select') return false
  return policy.selectedOrderIds.includes(orderId)
}

/** True when a D2H blocker message belongs to Step 2 policy, not Step 4 ops. */
export function isD2hPolicyBlockerMessage(message: string): boolean {
  const text = message.trim()
  return (
    text.startsWith('Distributor order ')
    || text.includes('D2H policy is required')
    || text.includes('Allocation ownership does not reconcile')
    || text.includes('Carried allocation exceeds physical opening')
  )
}

const errorText = (error: unknown) => {
  if (!error || typeof error !== 'object') return String(error ?? '')
  const candidate = error as {
    code?: unknown
    message?: unknown
    details?: unknown
    hint?: unknown
  }
  return [candidate.code, candidate.message, candidate.details, candidate.hint]
    .filter(value => value != null)
    .map(String)
    .join(' ')
    .toLowerCase()
}

export function categorizeD2hPolicyError(
  error: unknown,
  apply: boolean,
): { category: D2hPolicyErrorCategory; status: number; errorCode: string; userMessage: string } {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown }
    : {}
  const errorCode = typeof candidate.code === 'string' ? candidate.code : 'unknown'
  const text = errorText(error)

  if (
    errorCode === 'PGRST202'
    || errorCode === '42883'
    || text.includes('could not find the function')
    || text.includes('does not exist')
    || text.includes('schema cache')
  ) {
    return {
      category: 'd2h_policy_resolver_unavailable',
      status: 503,
      errorCode,
      userMessage: 'The D2H policy database resolver is unavailable. Refresh after the local corrective migration is applied.',
    }
  }
  if (
    errorCode === '42501'
    || errorCode === 'PGRST301'
    || text.includes('permission_denied')
    || text.includes('permission denied')
    || text.includes('not authenticated')
  ) {
    return {
      category: 'd2h_policy_unauthorized',
      status: 403,
      errorCode,
      userMessage: 'Your session is not authorized to save a D2H policy.',
    }
  }
  if (
    apply
    && (text.includes('inventory_cutoff_d2h_policy_scope_changed')
      || text.includes('inventory_cutoff_d2h_policy_idempotency_conflict'))
  ) {
    return {
      category: 'd2h_policy_stale_confirmation',
      status: 409,
      errorCode,
      userMessage: 'D2H scope changed. Review the refreshed counts and confirm again.',
    }
  }
  return {
    category: 'd2h_policy_preflight_failed',
    status: 400,
    errorCode,
    userMessage: apply
      ? 'The D2H policy was not saved. Refresh and retry. The Opening Balance was not cancelled.'
      : 'The D2H policy check failed. Refresh and retry. No decisions were changed.',
  }
}
