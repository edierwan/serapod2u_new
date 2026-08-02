// ============================================================================
// Opening Balance H2M policy — Option A (exclude all) / Option B (review select)
// ----------------------------------------------------------------------------
// Pure helpers + RPC response parsing for the authoritative server H2M policy
// RPCs. Mirrors the D2H policy contract: preflight → confirm fingerprint → apply.
// Never cancels a cutoff, never adds H2M quantity at posting, never touches QR.
// ============================================================================

export type H2mPolicy = 'exclude_all' | 'review_select'

export const H2M_POLICY_MIGRATION =
  '20260801090000_inventory_cutoff_h2m_policy.sql'

export const H2M_POLICY_LABELS: Record<H2mPolicy, string> = {
  exclude_all: 'Start Fresh — Exclude All Existing H2M Orders',
  review_select: 'Review Orders Expected After Cut-off',
}

export const H2M_POLICY_DESCRIPTIONS: Record<H2mPolicy, string> = {
  exclude_all:
    'Existing manufacturer orders remain available for reporting and audit, but will not be carried into the new inventory period.',
  review_select:
    'Select existing manufacturer orders whose remaining goods are genuinely expected to arrive after the Opening Balance.',
}

export type H2mPolicyErrorCategory =
  | 'h2m_policy_resolver_unavailable'
  | 'h2m_policy_unauthorized'
  | 'h2m_policy_invalid_response'
  | 'h2m_policy_preflight_failed'
  | 'h2m_policy_stale_confirmation'

export interface H2mPolicyOrderSummary {
  orderId: string
  orderNumber: string
  status: string
  manufacturer: string
  itemCount: number
  orderedQuantity: number
  receivedBeforeBoundary: number
  outstandingQuantity: number
  treatment: 'select' | 'exclude' | 'blocked'
  blockedReason: string | null
}

export interface H2mPolicySummary {
  policy: H2mPolicy
  cutoffId: string
  boundaryAt: string
  confirmationFingerprint: string
  warehouseOrganizationId: string
  companyId: string
  productCategoryId: string | null
  productCategoryName: string
  eligibleOrderCount: number
  eligibleItemCount: number
  eligibleOrderedQuantity: number
  eligibleReceivedBeforeBoundary: number
  eligibleOutstandingQuantity: number
  eligibleQuantity: number
  selectedOrderCount: number
  selectedItemCount: number
  selectedOrderedQuantity: number
  selectedReceivedBeforeBoundary: number
  selectedOutstandingQuantity: number
  selectedQuantity: number
  excludedOrderCount: number
  excludedItemCount: number
  excludedOrderedQuantity: number
  excludedReceivedBeforeBoundary: number
  excludedOutstandingQuantity: number
  excludedQuantity: number
  blockedOrderCount: number
  eligibleOrderIds: string[]
  selectedOrderIds: string[]
  excludedOrderIds: string[]
  blockedOrderIds: string[]
  orderSummaries: H2mPolicyOrderSummary[]
  ordersCancelled: false
  inventoryAdded: false
  historicalMovementsReversed: false
  qrImpact: 'none'
  notice: string
}

export interface H2mPolicySnapshot {
  policy: H2mPolicy
  boundaryAt: string
  warehouseOrganizationId?: string
  companyId?: string
  productCategoryId?: string
  eligibleOrderCount: number
  eligibleItemCount: number
  eligibleQuantity: number
  eligibleOrderedQuantity?: number
  eligibleReceivedBeforeBoundary?: number
  eligibleOutstandingQuantity?: number
  selectedOrderCount: number
  selectedItemCount: number
  selectedQuantity: number
  selectedOrderedQuantity?: number
  selectedReceivedBeforeBoundary?: number
  selectedOutstandingQuantity?: number
  excludedOrderCount: number
  excludedItemCount: number
  excludedQuantity: number
  excludedOrderedQuantity?: number
  excludedReceivedBeforeBoundary?: number
  excludedOutstandingQuantity?: number
  eligibleOrderIds: string[]
  selectedOrderIds: string[]
  excludedOrderIds: string[]
  decidedBy?: string
  decidedAt?: string
  confirmationFingerprint?: string
  ordersCancelled: false
  inventoryAdded: false
  historicalMovementsReversed: false
  qrImpact: 'none'
}

export interface H2mHistoricalSummary {
  orderCount: number
  itemCount: number
  orderedQuantity: number
  receivedBeforeBoundary: number
  outstandingQuantity: number
  ordersCancelled: false
  inventoryAdded: false
  notice: string | null
}

export class H2mPolicyInvalidResponseError extends Error {
  readonly details: { field: string; expected: string; actual: string }

  constructor(field: string, expected: string, value: unknown) {
    super('h2m_policy_invalid_response')
    this.name = 'H2mPolicyInvalidResponseError'
    this.details = { field, expected, actual: describeSafeValue(value) }
  }
}

const policies = new Set<H2mPolicy>(['exclude_all', 'review_select'])
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
  throw new H2mPolicyInvalidResponseError(field, expected, value)
}

export function normalizeH2mPolicyRpcResponse(value: unknown): Record<string, unknown> {
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

const optionalCount = (row: Record<string, unknown>, key: string, fallback = 0): number => {
  if (row[key] === undefined || row[key] === null) return fallback
  return requiredCount(row, key)
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

export function parseH2mPolicySnapshot(value: unknown): H2mPolicySnapshot | null {
  if (value == null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('h2m_policy', 'a JSON object or null', value)
  }
  const row = value as Record<string, unknown>
  const policy = row.policy
  if (typeof policy !== 'string' || !policies.has(policy as H2mPolicy)) {
    invalid('h2m_policy.policy', 'exclude_all or review_select', policy)
  }
  const outstanding = optionalCount(
    row,
    'eligible_outstanding_quantity',
    optionalCount(row, 'eligible_quantity'),
  )
  const selectedOutstanding = optionalCount(
    row,
    'selected_outstanding_quantity',
    optionalCount(row, 'selected_quantity'),
  )
  const excludedOutstanding = optionalCount(
    row,
    'excluded_outstanding_quantity',
    optionalCount(row, 'excluded_quantity'),
  )
  return {
    policy: policy as H2mPolicy,
    boundaryAt: requiredString(row, 'boundary_at'),
    warehouseOrganizationId: optionalUuid(row, 'warehouse_organization_id') ?? undefined,
    companyId: optionalUuid(row, 'company_id') ?? undefined,
    productCategoryId: optionalUuid(row, 'product_category_id') ?? undefined,
    eligibleOrderCount: requiredCount(row, 'eligible_order_count'),
    eligibleItemCount: requiredCount(row, 'eligible_item_count'),
    eligibleQuantity: outstanding,
    eligibleOrderedQuantity: optionalCount(row, 'eligible_ordered_quantity'),
    eligibleReceivedBeforeBoundary: optionalCount(row, 'eligible_received_before_boundary'),
    eligibleOutstandingQuantity: outstanding,
    selectedOrderCount: requiredCount(row, 'selected_order_count'),
    selectedItemCount: requiredCount(row, 'selected_item_count'),
    selectedQuantity: selectedOutstanding,
    selectedOrderedQuantity: optionalCount(row, 'selected_ordered_quantity'),
    selectedReceivedBeforeBoundary: optionalCount(row, 'selected_received_before_boundary'),
    selectedOutstandingQuantity: selectedOutstanding,
    excludedOrderCount: requiredCount(row, 'excluded_order_count'),
    excludedItemCount: requiredCount(row, 'excluded_item_count'),
    excludedQuantity: excludedOutstanding,
    excludedOrderedQuantity: optionalCount(row, 'excluded_ordered_quantity'),
    excludedReceivedBeforeBoundary: optionalCount(row, 'excluded_received_before_boundary'),
    excludedOutstandingQuantity: excludedOutstanding,
    eligibleOrderIds: requiredUuidArray(row, 'eligible_order_ids'),
    selectedOrderIds: requiredUuidArray(row, 'selected_order_ids'),
    excludedOrderIds: requiredUuidArray(row, 'excluded_order_ids'),
    decidedBy: optionalUuid(row, 'decided_by') ?? undefined,
    decidedAt: typeof row.decided_at === 'string' ? row.decided_at : undefined,
    confirmationFingerprint: typeof row.confirmation_fingerprint === 'string'
      ? row.confirmation_fingerprint
      : undefined,
    ordersCancelled: false,
    inventoryAdded: false,
    historicalMovementsReversed: false,
    qrImpact: 'none',
  }
}

export function parseH2mHistoricalSummary(value: unknown): H2mHistoricalSummary | null {
  if (value == null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('h2m_historical_summary', 'a JSON object or null', value)
  }
  const row = value as Record<string, unknown>
  return {
    orderCount: requiredCount(row, 'order_count'),
    itemCount: requiredCount(row, 'item_count'),
    orderedQuantity: requiredCount(row, 'ordered_quantity'),
    receivedBeforeBoundary: optionalCount(row, 'received_before_boundary'),
    outstandingQuantity: optionalCount(row, 'outstanding_quantity'),
    ordersCancelled: false,
    inventoryAdded: false,
    notice: typeof row.notice === 'string' ? row.notice : null,
  }
}

export function parseH2mPolicySummary(value: unknown): H2mPolicySummary {
  const row = normalizeH2mPolicyRpcResponse(value)
  const policy = row.policy
  if (typeof policy !== 'string' || !policies.has(policy as H2mPolicy)) {
    invalid('policy', 'exclude_all or review_select', policy)
  }

  const orderSummariesRaw = row.order_summaries
  const orderSummaries: H2mPolicyOrderSummary[] = []
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
        manufacturer: typeof order.manufacturer === 'string' ? order.manufacturer : '—',
        itemCount: requiredCount(order, 'item_count'),
        orderedQuantity: requiredCount(order, 'ordered_quantity'),
        receivedBeforeBoundary: optionalCount(order, 'received_before_boundary'),
        outstandingQuantity: optionalCount(order, 'outstanding_quantity'),
        treatment,
        blockedReason: typeof order.blocked_reason === 'string' ? order.blocked_reason : null,
      })
    }
  }

  const categoryName = row.product_category_name
  if (categoryName !== undefined && (typeof categoryName !== 'string' || categoryName.length === 0)) {
    invalid('product_category_name', 'a non-empty string when present', categoryName)
  }

  const eligibleOutstanding = optionalCount(
    row,
    'eligible_outstanding_quantity',
    optionalCount(row, 'eligible_quantity'),
  )
  const selectedOutstanding = optionalCount(
    row,
    'selected_outstanding_quantity',
    optionalCount(row, 'selected_quantity'),
  )
  const excludedOutstanding = optionalCount(
    row,
    'excluded_outstanding_quantity',
    optionalCount(row, 'excluded_quantity'),
  )

  return {
    policy: policy as H2mPolicy,
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
    eligibleOrderedQuantity: optionalCount(row, 'eligible_ordered_quantity'),
    eligibleReceivedBeforeBoundary: optionalCount(row, 'eligible_received_before_boundary'),
    eligibleOutstandingQuantity: eligibleOutstanding,
    eligibleQuantity: eligibleOutstanding,
    selectedOrderCount: requiredCount(row, 'selected_order_count'),
    selectedItemCount: requiredCount(row, 'selected_item_count'),
    selectedOrderedQuantity: optionalCount(row, 'selected_ordered_quantity'),
    selectedReceivedBeforeBoundary: optionalCount(row, 'selected_received_before_boundary'),
    selectedOutstandingQuantity: selectedOutstanding,
    selectedQuantity: selectedOutstanding,
    excludedOrderCount: requiredCount(row, 'excluded_order_count'),
    excludedItemCount: requiredCount(row, 'excluded_item_count'),
    excludedOrderedQuantity: optionalCount(row, 'excluded_ordered_quantity'),
    excludedReceivedBeforeBoundary: optionalCount(row, 'excluded_received_before_boundary'),
    excludedOutstandingQuantity: excludedOutstanding,
    excludedQuantity: excludedOutstanding,
    blockedOrderCount: requiredCount(row, 'blocked_order_count'),
    eligibleOrderIds: requiredUuidArray(row, 'eligible_order_ids'),
    selectedOrderIds: requiredUuidArray(row, 'selected_order_ids'),
    excludedOrderIds: requiredUuidArray(row, 'excluded_order_ids'),
    blockedOrderIds: requiredUuidArray(row, 'blocked_order_ids'),
    orderSummaries,
    ordersCancelled: false,
    inventoryAdded: false,
    historicalMovementsReversed: false,
    qrImpact: 'none',
    notice: requiredString(row, 'notice'),
  }
}

export function serializeH2mPolicySummary(summary: H2mPolicySummary) {
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
    eligible_ordered_quantity: summary.eligibleOrderedQuantity,
    eligible_received_before_boundary: summary.eligibleReceivedBeforeBoundary,
    eligible_outstanding_quantity: summary.eligibleOutstandingQuantity,
    eligible_quantity: summary.eligibleQuantity,
    selected_order_count: summary.selectedOrderCount,
    selected_item_count: summary.selectedItemCount,
    selected_ordered_quantity: summary.selectedOrderedQuantity,
    selected_received_before_boundary: summary.selectedReceivedBeforeBoundary,
    selected_outstanding_quantity: summary.selectedOutstandingQuantity,
    selected_quantity: summary.selectedQuantity,
    excluded_order_count: summary.excludedOrderCount,
    excluded_item_count: summary.excludedItemCount,
    excluded_ordered_quantity: summary.excludedOrderedQuantity,
    excluded_received_before_boundary: summary.excludedReceivedBeforeBoundary,
    excluded_outstanding_quantity: summary.excludedOutstandingQuantity,
    excluded_quantity: summary.excludedQuantity,
    blocked_order_count: summary.blockedOrderCount,
    eligible_order_ids: summary.eligibleOrderIds,
    selected_order_ids: summary.selectedOrderIds,
    excluded_order_ids: summary.excludedOrderIds,
    blocked_order_ids: summary.blockedOrderIds,
    orders_cancelled: false,
    inventory_added: false,
    historical_movements_reversed: false,
    qr_impact: 'none',
    notice: summary.notice,
  }
}

/** Step 3 is resolved once an H2M policy snapshot is saved for the cutoff. */
export function isH2mPolicyResolved(policy: H2mPolicySnapshot | null | undefined): boolean {
  return Boolean(policy?.policy)
}

export function isH2mOrderHistoricallyExcluded(
  orderId: string | undefined,
  decision: string | null | undefined,
  classification: string | null | undefined,
  policy: H2mPolicySnapshot | null | undefined,
): boolean {
  if (!orderId) return false
  if (classification === 'Historical Excluded' || classification === 'History Only') {
    return true
  }
  if (decision === 'history_only') return true
  if (!policy) return false
  if (policy.policy === 'exclude_all') return !policy.selectedOrderIds.includes(orderId)
  return policy.excludedOrderIds.includes(orderId)
}

export function isH2mOrderExpectedIncoming(
  orderId: string | undefined,
  decision: string | null | undefined,
  policy: H2mPolicySnapshot | null | undefined,
): boolean {
  if (!orderId) return false
  if (decision === 'carry_forward_incoming') return true
  if (!policy || policy.policy !== 'review_select') return false
  return policy.selectedOrderIds.includes(orderId)
}

export function isH2mPolicyBlockerMessage(message: string): boolean {
  const text = message.trim()
  return (
    text.startsWith('Manufacturer order ')
    || text.startsWith('H2M order ')
    || text.includes('H2M policy is required')
    || text.includes('An H2M policy is required')
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

export function categorizeH2mPolicyError(
  error: unknown,
  apply: boolean,
): { category: H2mPolicyErrorCategory; status: number; errorCode: string; userMessage: string } {
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
      category: 'h2m_policy_resolver_unavailable',
      status: 503,
      errorCode,
      userMessage: 'The H2M policy database resolver is unavailable. Refresh after the local H2M policy migration is applied.',
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
      category: 'h2m_policy_unauthorized',
      status: 403,
      errorCode,
      userMessage: 'Your session is not authorized to save an H2M policy.',
    }
  }
  if (
    apply
    && (text.includes('inventory_cutoff_h2m_policy_scope_changed')
      || text.includes('inventory_cutoff_h2m_policy_idempotency_conflict'))
  ) {
    return {
      category: 'h2m_policy_stale_confirmation',
      status: 409,
      errorCode,
      userMessage: 'H2M policy scope changed. Review the refreshed counts and confirm again.',
    }
  }
  return {
    category: 'h2m_policy_preflight_failed',
    status: 400,
    errorCode,
    userMessage: apply
      ? 'The H2M policy was not saved. Refresh and retry. The Opening Balance was not cancelled.'
      : 'The H2M policy check failed. Refresh and retry. No decisions were changed.',
  }
}
