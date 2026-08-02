export type H2mBulkAction =
  | 'selected_incoming'
  | 'selected_not_incoming'
  | 'all_remaining_not_incoming'

export const H2M_BULK_MIGRATION =
  '20260731173000_inventory_cutoff_h2m_bulk_contract_targeting_fix.sql'

export type H2mBulkErrorCategory =
  | 'h2m_bulk_resolver_unavailable'
  | 'h2m_bulk_unauthorized'
  | 'h2m_bulk_invalid_response'
  | 'h2m_bulk_preflight_failed'
  | 'h2m_bulk_stale_confirmation'

export interface H2mBulkSummary {
  action: H2mBulkAction
  cutoffId: string
  confirmationFingerprint: string
  productCategoryId: string | null
  productCategoryName: string
  eligibleItemCount: number
  affectedOrderCount: number
  resolvedItemCount: number
  savedIncomingCount: number
  savedNotIncomingCount: number
  blockedItemCount: number
  eligibleOrderIds: string[]
  eligibleItemIds: string[]
  blockedItemIds: string[]
}

export interface H2mBulkInvalidResponseDetails {
  field: string
  expected: string
  actual: string
}

export class H2mBulkInvalidResponseError extends Error {
  readonly details: H2mBulkInvalidResponseDetails

  constructor(field: string, expected: string, value: unknown) {
    super('h2m_bulk_invalid_response')
    this.name = 'H2mBulkInvalidResponseError'
    this.details = { field, expected, actual: describeSafeValue(value) }
  }
}

const actions = new Set<H2mBulkAction>([
  'selected_incoming',
  'selected_not_incoming',
  'all_remaining_not_incoming',
])
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

export function describeH2mBulkRpcResponse(value: unknown) {
  const responseType = value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : typeof value === 'object'
        ? 'object'
        : 'other'
  const topLevelKeys = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).sort()
    : Array.isArray(value) && value.length === 1 && value[0] &&
        typeof value[0] === 'object' && !Array.isArray(value[0])
      ? Object.keys(value[0] as Record<string, unknown>).sort()
      : []
  return { responseType, topLevelKeys }
}

const invalid = (field: string, expected: string, value: unknown): never => {
  throw new H2mBulkInvalidResponseError(field, expected, value)
}

export function normalizeH2mBulkRpcResponse(value: unknown): Record<string, unknown> {
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

const requiredString = (
  row: Record<string, unknown>,
  key: string,
): string => {
  const value = row[key]
  if (typeof value !== 'string' || value.length === 0) {
    invalid(key, 'a non-empty string', value)
  }
  return value as string
}

const requiredUuid = (
  row: Record<string, unknown>,
  key: string,
): string => {
  const value = requiredString(row, key)
  if (!uuidPattern.test(value)) invalid(key, 'a UUID string', value)
  return value as string
}

const optionalUuid = (
  row: Record<string, unknown>,
  key: string,
): string | null => {
  const value = row[key]
  if (value === undefined) return null
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    invalid(key, 'a UUID string when present', value)
  }
  return value as string
}

const requiredCount = (
  row: Record<string, unknown>,
  key: string,
): number => {
  const value = row[key]
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    invalid(key, 'a non-negative safe integer or numeric string', value)
  }
  return parsed
}

const requiredUuidArray = (
  row: Record<string, unknown>,
  key: string,
): string[] => {
  const value = row[key]
  if (!Array.isArray(value)) invalid(key, 'a UUID array', value)
  const result = value as unknown[]
  const rejected = result.find(item => typeof item !== 'string' || !uuidPattern.test(item))
  if (rejected !== undefined) invalid(`${key}[]`, 'a UUID string', rejected)
  const strings = result as string[]
  if (new Set(strings).size !== strings.length) invalid(key, 'a unique UUID array', value)
  return strings
}

export function parseH2mBulkSummary(value: unknown): H2mBulkSummary {
  const row = normalizeH2mBulkRpcResponse(value)
  const action = row.action
  if (typeof action !== 'string' || !actions.has(action as H2mBulkAction)) {
    invalid('action', 'a supported H2M bulk action', action)
  }

  const eligibleItemCount = requiredCount(row, 'eligible_item_count')
  const affectedOrderCount = requiredCount(row, 'affected_order_count')
  const blockedItemCount = requiredCount(row, 'blocked_item_count')
  const eligibleOrderIds = requiredUuidArray(row, 'eligible_order_ids')
  const eligibleItemIds = requiredUuidArray(row, 'eligible_item_ids')
  const blockedItemIds = requiredUuidArray(row, 'blocked_item_ids')

  if (eligibleItemCount !== eligibleItemIds.length) {
    invalid('eligible_item_count', `the eligible_item_ids length (${eligibleItemIds.length})`, row.eligible_item_count)
  }
  if (affectedOrderCount !== eligibleOrderIds.length) {
    invalid('affected_order_count', `the eligible_order_ids length (${eligibleOrderIds.length})`, row.affected_order_count)
  }
  if (blockedItemCount !== blockedItemIds.length) {
    invalid('blocked_item_count', `the blocked_item_ids length (${blockedItemIds.length})`, row.blocked_item_count)
  }

  const categoryName = row.product_category_name
  if (categoryName !== undefined && (typeof categoryName !== 'string' || categoryName.length === 0)) {
    invalid('product_category_name', 'a non-empty string when present', categoryName)
  }

  return {
    action: action as H2mBulkAction,
    cutoffId: requiredUuid(row, 'cutoff_id'),
    confirmationFingerprint: requiredString(row, 'confirmation_fingerprint'),
    productCategoryId: optionalUuid(row, 'product_category_id'),
    productCategoryName: typeof categoryName === 'string'
      ? categoryName
      : 'the current Opening Balance category',
    eligibleItemCount,
    affectedOrderCount,
    resolvedItemCount: requiredCount(row, 'resolved_item_count'),
    savedIncomingCount: requiredCount(row, 'saved_incoming_count'),
    savedNotIncomingCount: requiredCount(row, 'saved_not_incoming_count'),
    blockedItemCount,
    eligibleOrderIds,
    eligibleItemIds,
    blockedItemIds,
  }
}

export function serializeH2mBulkSummary(summary: H2mBulkSummary) {
  return {
    action: summary.action,
    cutoff_id: summary.cutoffId,
    confirmation_fingerprint: summary.confirmationFingerprint,
    ...(summary.productCategoryId
      ? { product_category_id: summary.productCategoryId }
      : {}),
    product_category_name: summary.productCategoryName,
    eligible_item_count: summary.eligibleItemCount,
    affected_order_count: summary.affectedOrderCount,
    resolved_item_count: summary.resolvedItemCount,
    saved_incoming_count: summary.savedIncomingCount,
    saved_not_incoming_count: summary.savedNotIncomingCount,
    blocked_item_count: summary.blockedItemCount,
    eligible_order_ids: summary.eligibleOrderIds,
    eligible_item_ids: summary.eligibleItemIds,
    blocked_item_ids: summary.blockedItemIds,
  }
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

export function categorizeH2mBulkError(
  error: unknown,
  apply: boolean,
): { category: H2mBulkErrorCategory; status: number; errorCode: string; userMessage: string } {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown }
    : {}
  const errorCode = typeof candidate.code === 'string' ? candidate.code : 'unknown'
  const text = errorText(error)

  if (
    errorCode === 'PGRST202' ||
    errorCode === '42883' ||
    text.includes('could not find the function') ||
    text.includes('does not exist') ||
    text.includes('schema cache')
  ) {
    return {
      category: 'h2m_bulk_resolver_unavailable',
      status: 503,
      errorCode,
      userMessage: 'The H2M bulk database resolver is unavailable. Refresh after the local corrective migration is applied.',
    }
  }
  if (
    errorCode === '42501' ||
    errorCode === 'PGRST301' ||
    text.includes('permission_denied') ||
    text.includes('permission denied') ||
    text.includes('not authenticated')
  ) {
    return {
      category: 'h2m_bulk_unauthorized',
      status: 403,
      errorCode,
      userMessage: 'Your session is not authorized to run this H2M bulk action.',
    }
  }
  if (
    apply &&
    (text.includes('inventory_cutoff_h2m_bulk_scope_changed') ||
      text.includes('inventory_cutoff_h2m_bulk_idempotency_conflict'))
  ) {
    return {
      category: 'h2m_bulk_stale_confirmation',
      status: 409,
      errorCode,
      userMessage: 'H2M scope changed. Review the refreshed counts and confirm again.',
    }
  }
  return {
    category: 'h2m_bulk_preflight_failed',
    status: 400,
    errorCode,
    userMessage: apply
      ? 'The H2M decisions were not applied. Refresh and retry.'
      : 'The H2M bulk check failed. Refresh and retry. No decisions were changed.',
  }
}
