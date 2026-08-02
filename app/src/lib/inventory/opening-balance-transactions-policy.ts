// ============================================================================
// Opening Balance Transactions policy — one policy for the eligible existing
// Stock Adjustments, Returns and Stock Transfers surfaced in the Transactions
// step. Pure helpers + RPC response parsing for the authoritative server RPCs.
// Mirrors the D2H / H2M policy contract: preflight → confirm fingerprint → apply.
//
// Saving a policy and posting the Opening Balance create ZERO inventory impact
// from these transactions. This module never cancels a cutoff, never trusts a
// client quantity, never invents a Return stock direction, and never touches QR.
// ============================================================================

export type TransactionsPolicy = 'exclude_all' | 'carry_forward_all' | 'review_select'

export type TransactionType = 'stock_adjustment' | 'return' | 'stock_transfer'

export type TransactionEligibility = 'eligible' | 'requires_resolution'

export type TransactionTreatment = 'carry' | 'exclude' | 'blocked'

export const TRANSACTIONS_POLICY_MIGRATION =
  '20260801140000_inventory_cutoff_transactions_policy.sql'

/** The Step 4 heading required by the specification. */
export const TRANSACTIONS_POLICY_HEADING =
  'How should eligible existing transactions be treated?'

export const TRANSACTIONS_POLICY_ORDER: TransactionsPolicy[] = [
  'exclude_all',
  'carry_forward_all',
  'review_select',
]

export const TRANSACTIONS_POLICY_LABELS: Record<TransactionsPolicy, string> = {
  exclude_all: 'Start Fresh — Exclude All Eligible Transactions',
  carry_forward_all: 'Carry Forward All Eligible Transactions',
  review_select: 'Review Transactions to Carry Forward',
}

export const TRANSACTIONS_POLICY_DESCRIPTIONS: Record<TransactionsPolicy, string> = {
  exclude_all:
    'Every eligible pre-boundary transaction is kept for history and audit but excluded from the new inventory baseline. Nothing is deleted or cancelled.',
  carry_forward_all:
    'Every server-eligible transaction keeps its authoritative lifecycle and continues after the cut-off. No inventory is added or deducted while saving.',
  review_select:
    'Show the transaction list and carry forward only the ones you check. Unchecked eligible transactions are kept as historical excluded.',
}

/** Row-level checkbox meaning — the only transaction-level decision mechanism. */
export const TRANSACTIONS_REVIEW_CHECKBOX_HINT =
  'Checked = Carry Forward · Unchecked = Historical Excluded'

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  stock_adjustment: 'Stock Adjustment',
  return: 'Return',
  stock_transfer: 'Stock Transfer',
}

export type TransactionsFilter =
  | 'all'
  | 'stock_adjustment'
  | 'return'
  | 'stock_transfer'
  | 'attention'

export const TRANSACTIONS_FILTERS: { id: TransactionsFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'stock_adjustment', label: 'Stock Adjustments' },
  { id: 'return', label: 'Returns' },
  { id: 'stock_transfer', label: 'Stock Transfers' },
  { id: 'attention', label: 'Requires Attention' },
]

export type TransactionsPolicyErrorCategory =
  | 'transactions_policy_resolver_unavailable'
  | 'transactions_policy_unauthorized'
  | 'transactions_policy_invalid_response'
  | 'transactions_policy_preflight_failed'
  | 'transactions_policy_stale_confirmation'

export interface TransactionRef {
  type: TransactionType
  id: string
}

export interface TransactionSummaryRow {
  transactionType: TransactionType
  transactionId: string
  referenceNo: string | null
  status: string
  occurredAt: string | null
  documentQuantity: number
  lineCount: number
  latestStage: string
  remainingAction: string
  expectedEvent: string
  eligibility: TransactionEligibility
  blockerReason: string | null
  treatment: TransactionTreatment
}

export interface TransactionsPolicySummary {
  policy: TransactionsPolicy
  cutoffId: string
  boundaryAt: string
  confirmationFingerprint: string
  warehouseOrganizationId: string
  companyId: string
  productCategoryId: string | null
  productCategoryName: string
  eligibleCount: number
  carriedCount: number
  excludedCount: number
  blockedCount: number
  carriedRefs: TransactionRef[]
  excludedRefs: TransactionRef[]
  eligibleRefs: TransactionRef[]
  transactionSummaries: TransactionSummaryRow[]
  inventoryImpact: 0
  transactionsCancelled: false
  stockMovementsCreated: false
  qrImpact: 'none'
  notice: string
}

export interface TransactionsPolicySnapshot {
  policy: TransactionsPolicy
  boundaryAt: string
  warehouseOrganizationId?: string
  companyId?: string
  productCategoryId?: string
  eligibleCount: number
  carriedCount: number
  excludedCount: number
  blockedCount: number
  carriedAdjustmentIds: string[]
  carriedReturnIds: string[]
  carriedTransferIds: string[]
  excludedAdjustmentIds: string[]
  excludedReturnIds: string[]
  excludedTransferIds: string[]
  carriedRefs: TransactionRef[]
  excludedRefs: TransactionRef[]
  eligibleRefs: TransactionRef[]
  decidedBy?: string
  decidedAt?: string
  confirmationFingerprint?: string
  inventoryImpact: 0
  transactionsCancelled: false
  stockMovementsCreated: false
  qrImpact: 'none'
}

export interface TransactionsHistoricalSummary {
  eligibleCount: number
  carriedCount: number
  excludedCount: number
  blockedCount: number
  inventoryImpact: 0
  transactionsCancelled: false
  notice: string | null
}

export class TransactionsPolicyInvalidResponseError extends Error {
  readonly details: { field: string; expected: string; actual: string }

  constructor(field: string, expected: string, value: unknown) {
    super('transactions_policy_invalid_response')
    this.name = 'TransactionsPolicyInvalidResponseError'
    this.details = { field, expected, actual: describeSafeValue(value) }
  }
}

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
  throw new TransactionsPolicyInvalidResponseError(field, expected, value)
}

export function normalizeTransactionsPolicyRpcResponse(
  value: unknown,
): Record<string, unknown> {
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

const parseRefs = (value: unknown, field: string): TransactionRef[] => {
  if (value == null) return []
  if (!Array.isArray(value)) invalid(field, 'an array of {type,id}', value)
  const refs: TransactionRef[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      invalid(`${field}[]`, 'a {type,id} object', item)
    }
    const row = item as Record<string, unknown>
    const type = row.type
    const id = row.id
    if (typeof type !== 'string' || !transactionTypes.has(type as TransactionType)) {
      invalid(`${field}[].type`, 'stock_adjustment|return|stock_transfer', type)
    }
    if (typeof id !== 'string' || !uuidPattern.test(id)) {
      invalid(`${field}[].id`, 'a UUID string', id)
    }
    refs.push({ type: type as TransactionType, id })
  }
  return refs
}

const parseUuidArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && uuidPattern.test(id))
    : []

/** Serialize a checked/carried selection for the RPC `p_carried_refs` argument. */
export function serializeCarriedRefs(refs: TransactionRef[]): { type: string; id: string }[] {
  const seen = new Set<string>()
  const out: { type: string; id: string }[] = []
  for (const ref of refs) {
    if (!transactionTypes.has(ref.type) || !uuidPattern.test(ref.id)) continue
    const key = `${ref.type}:${ref.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type: ref.type, id: ref.id })
  }
  return out
}

/** Boundary used for pre-cut-off classification (before posting: proposed). */
export function transactionsCutoffBoundaryAt(input: {
  proposedCutoffAt?: string | null
  postedAt?: string | null
  cutoffBoundaryAt?: string | null
}): string | null {
  return input.cutoffBoundaryAt || input.postedAt || input.proposedCutoffAt || null
}

function parseTransactionSummaries(value: unknown): TransactionSummaryRow[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) invalid('transaction_summaries', 'an array', value)
  const rows: TransactionSummaryRow[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      invalid('transaction_summaries[]', 'a JSON object', item)
    }
    const row = item as Record<string, unknown>
    const type = row.transaction_type
    if (typeof type !== 'string' || !transactionTypes.has(type as TransactionType)) {
      invalid('transaction_summaries[].transaction_type', 'a transaction type', type)
    }
    const eligibility = row.eligibility
    if (eligibility !== 'eligible' && eligibility !== 'requires_resolution') {
      invalid('transaction_summaries[].eligibility', 'eligible|requires_resolution', eligibility)
    }
    const treatment = row.treatment
    if (treatment !== 'carry' && treatment !== 'exclude' && treatment !== 'blocked') {
      invalid('transaction_summaries[].treatment', 'carry|exclude|blocked', treatment)
    }
    rows.push({
      transactionType: type as TransactionType,
      transactionId: requiredUuid(row, 'transaction_id'),
      referenceNo: typeof row.reference_no === 'string' ? row.reference_no : null,
      status: typeof row.status === 'string' ? row.status : 'unknown',
      occurredAt: typeof row.occurred_at === 'string' ? row.occurred_at : null,
      documentQuantity: requiredCount(row, 'document_quantity'),
      lineCount: requiredCount(row, 'line_count'),
      latestStage: typeof row.latest_stage === 'string' ? row.latest_stage : '',
      remainingAction: typeof row.remaining_action === 'string' ? row.remaining_action : '',
      expectedEvent: typeof row.expected_event === 'string' ? row.expected_event : '',
      eligibility: eligibility as TransactionEligibility,
      blockerReason: typeof row.blocker_reason === 'string' ? row.blocker_reason : null,
      treatment: treatment as TransactionTreatment,
    })
  }
  return rows
}

export function parseTransactionsPolicySummary(value: unknown): TransactionsPolicySummary {
  const row = normalizeTransactionsPolicyRpcResponse(value)
  const policy = row.policy
  if (typeof policy !== 'string' || !policies.has(policy as TransactionsPolicy)) {
    invalid('policy', 'exclude_all|carry_forward_all|review_select', policy)
  }
  const categoryName = row.product_category_name
  if (categoryName !== undefined && (typeof categoryName !== 'string' || categoryName.length === 0)) {
    invalid('product_category_name', 'a non-empty string when present', categoryName)
  }
  return {
    policy: policy as TransactionsPolicy,
    cutoffId: requiredUuid(row, 'cutoff_id'),
    boundaryAt: requiredString(row, 'boundary_at'),
    confirmationFingerprint: requiredString(row, 'confirmation_fingerprint'),
    warehouseOrganizationId: requiredUuid(row, 'warehouse_organization_id'),
    companyId: requiredUuid(row, 'company_id'),
    productCategoryId: optionalUuid(row, 'product_category_id'),
    productCategoryName: typeof categoryName === 'string'
      ? categoryName
      : 'the current Opening Balance category',
    eligibleCount: requiredCount(row, 'eligible_count'),
    carriedCount: requiredCount(row, 'carried_count'),
    excludedCount: requiredCount(row, 'excluded_count'),
    blockedCount: requiredCount(row, 'blocked_count'),
    carriedRefs: parseRefs(row.carried_refs, 'carried_refs'),
    excludedRefs: parseRefs(row.excluded_refs, 'excluded_refs'),
    eligibleRefs: parseRefs(row.eligible_refs, 'eligible_refs'),
    transactionSummaries: parseTransactionSummaries(row.transaction_summaries),
    inventoryImpact: 0,
    transactionsCancelled: false,
    stockMovementsCreated: false,
    qrImpact: 'none',
    notice: requiredString(row, 'notice'),
  }
}

export function serializeTransactionsPolicySummary(summary: TransactionsPolicySummary) {
  return {
    policy: summary.policy,
    cutoff_id: summary.cutoffId,
    boundary_at: summary.boundaryAt,
    confirmation_fingerprint: summary.confirmationFingerprint,
    warehouse_organization_id: summary.warehouseOrganizationId,
    company_id: summary.companyId,
    ...(summary.productCategoryId ? { product_category_id: summary.productCategoryId } : {}),
    product_category_name: summary.productCategoryName,
    eligible_count: summary.eligibleCount,
    carried_count: summary.carriedCount,
    excluded_count: summary.excludedCount,
    blocked_count: summary.blockedCount,
    carried_refs: summary.carriedRefs,
    excluded_refs: summary.excludedRefs,
    eligible_refs: summary.eligibleRefs,
    // NOTE: transaction_summaries is intentionally NOT re-serialized. The client
    // re-parses this response with parseTransactionsPolicySummary, and the
    // per-row detail it needs already comes from the read-only preview's
    // warehouse_activity. Emitting the camelCased summaries here would make the
    // client parser reject the response (transactions_policy_invalid_response).
    inventory_impact: 0,
    transactions_cancelled: false,
    stock_movements_created: false,
    qr_impact: 'none',
    notice: summary.notice,
  }
}

export function parseTransactionsPolicySnapshot(
  value: unknown,
): TransactionsPolicySnapshot | null {
  if (value == null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('transactions_policy', 'a JSON object or null', value)
  }
  const row = value as Record<string, unknown>
  const policy = row.policy
  if (typeof policy !== 'string' || !policies.has(policy as TransactionsPolicy)) {
    invalid('transactions_policy.policy', 'a transactions policy', policy)
  }
  return {
    policy: policy as TransactionsPolicy,
    boundaryAt: typeof row.boundary_at === 'string' ? row.boundary_at : '',
    warehouseOrganizationId: optionalUuid(row, 'warehouse_organization_id') ?? undefined,
    companyId: optionalUuid(row, 'company_id') ?? undefined,
    productCategoryId: optionalUuid(row, 'product_category_id') ?? undefined,
    eligibleCount: requiredCount(row, 'eligible_count'),
    carriedCount: requiredCount(row, 'carried_count'),
    excludedCount: requiredCount(row, 'excluded_count'),
    blockedCount: requiredCount(row, 'blocked_count'),
    carriedAdjustmentIds: parseUuidArray(row.carried_adjustment_ids),
    carriedReturnIds: parseUuidArray(row.carried_return_ids),
    carriedTransferIds: parseUuidArray(row.carried_transfer_ids),
    excludedAdjustmentIds: parseUuidArray(row.excluded_adjustment_ids),
    excludedReturnIds: parseUuidArray(row.excluded_return_ids),
    excludedTransferIds: parseUuidArray(row.excluded_transfer_ids),
    carriedRefs: parseRefs(row.carried_refs, 'transactions_policy.carried_refs'),
    excludedRefs: parseRefs(row.excluded_refs, 'transactions_policy.excluded_refs'),
    eligibleRefs: parseRefs(row.eligible_refs, 'transactions_policy.eligible_refs'),
    decidedBy: optionalUuid(row, 'decided_by') ?? undefined,
    decidedAt: typeof row.decided_at === 'string' ? row.decided_at : undefined,
    confirmationFingerprint:
      typeof row.confirmation_fingerprint === 'string' ? row.confirmation_fingerprint : undefined,
    inventoryImpact: 0,
    transactionsCancelled: false,
    stockMovementsCreated: false,
    qrImpact: 'none',
  }
}

export function parseTransactionsHistoricalSummary(
  value: unknown,
): TransactionsHistoricalSummary | null {
  if (value == null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('transactions_historical_summary', 'a JSON object or null', value)
  }
  const row = value as Record<string, unknown>
  return {
    eligibleCount: requiredCount(row, 'eligible_count'),
    carriedCount: requiredCount(row, 'carried_count'),
    excludedCount: requiredCount(row, 'excluded_count'),
    blockedCount: requiredCount(row, 'blocked_count'),
    inventoryImpact: 0,
    transactionsCancelled: false,
    notice: typeof row.notice === 'string' ? row.notice : null,
  }
}

/** Step 4 is resolved once a Transactions policy snapshot is saved. */
export function isTransactionsPolicyResolved(
  policy: TransactionsPolicySnapshot | null | undefined,
): boolean {
  return Boolean(policy?.policy)
}

/** A saved policy carries this transaction forward. */
export function isTransactionCarriedForward(
  ref: TransactionRef,
  policy: TransactionsPolicySnapshot | null | undefined,
): boolean {
  if (!policy) return false
  const ids =
    ref.type === 'stock_adjustment' ? policy.carriedAdjustmentIds
    : ref.type === 'return' ? policy.carriedReturnIds
    : policy.carriedTransferIds
  return ids.includes(ref.id)
}

/** A saved policy keeps this transaction as historical excluded. */
export function isTransactionHistoricallyExcluded(
  ref: TransactionRef,
  policy: TransactionsPolicySnapshot | null | undefined,
): boolean {
  if (!policy) return false
  const ids =
    ref.type === 'stock_adjustment' ? policy.excludedAdjustmentIds
    : ref.type === 'return' ? policy.excludedReturnIds
    : policy.excludedTransferIds
  return ids.includes(ref.id)
}

/**
 * The effective carried set derived from a chosen (unsaved) policy + a checked
 * selection, given the currently eligible transactions. Mirrors the server:
 *   exclude_all      → carry nothing (supersedes any stale selection)
 *   carry_forward_all→ carry every eligible transaction
 *   review_select    → carry only checked eligible transactions
 * Requires-resolution transactions are never carried by any policy.
 */
export function deriveEffectiveCarried(
  policy: TransactionsPolicy,
  eligibleRefs: TransactionRef[],
  checked: TransactionRef[],
): TransactionRef[] {
  if (policy === 'exclude_all') return []
  if (policy === 'carry_forward_all') return [...eligibleRefs]
  const checkedKeys = new Set(checked.map(r => `${r.type}:${r.id}`))
  return eligibleRefs.filter(r => checkedKeys.has(`${r.type}:${r.id}`))
}

/** Gate for leaving Step 4: a policy must be saved and no genuine blocker remains. */
export interface TransactionsPolicyGate {
  canContinue: boolean
  message: string | null
}

export function transactionsPolicyContinueGate(input: {
  policyResolved: boolean
  eligibleCount: number
  blockedCount: number
}): TransactionsPolicyGate {
  if (input.eligibleCount > 0 && !input.policyResolved) {
    return {
      canContinue: false,
      message:
        'Save a Transactions policy (Start Fresh, Carry Forward All, or Review) before continuing.',
    }
  }
  if (input.blockedCount > 0) {
    return {
      canContinue: false,
      message: `${input.blockedCount} transaction${input.blockedCount === 1 ? '' : 's'} require individual resolution before continuing.`,
    }
  }
  return { canContinue: true, message: null }
}

/** True when a blocker message belongs to the Transactions step (Step 4). */
export function isTransactionsPolicyBlockerMessage(message: string): boolean {
  const text = message.trim()
  return (
    text.includes('Transactions policy is required')
    || text.includes('requires individual resolution')
    || (text.startsWith('Stock adjustment ') && text.includes('must be completed'))
    || (text.startsWith('Transfer ') && text.includes('must be completed'))
    || (text.startsWith('Return ') && text.includes('must be completed'))
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

export function categorizeTransactionsPolicyError(
  error: unknown,
  apply: boolean,
): {
  category: TransactionsPolicyErrorCategory
  status: number
  errorCode: string
  userMessage: string
} {
  const candidate = error && typeof error === 'object' ? (error as { code?: unknown }) : {}
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
      category: 'transactions_policy_resolver_unavailable',
      status: 503,
      errorCode,
      userMessage:
        'The Transactions policy database resolver is unavailable. Refresh after the local corrective migration is applied.',
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
      category: 'transactions_policy_unauthorized',
      status: 403,
      errorCode,
      userMessage: 'Your session is not authorized to save a Transactions policy.',
    }
  }
  if (
    apply
    && (text.includes('inventory_cutoff_transactions_policy_scope_changed')
      || text.includes('inventory_cutoff_transactions_policy_idempotency_conflict'))
  ) {
    return {
      category: 'transactions_policy_stale_confirmation',
      status: 409,
      errorCode,
      userMessage: 'Transactions scope changed. Review the refreshed counts and confirm again.',
    }
  }
  return {
    category: 'transactions_policy_preflight_failed',
    status: 400,
    errorCode,
    userMessage: apply
      ? 'The Transactions policy was not saved. Refresh and retry. The Opening Balance was not cancelled.'
      : 'The Transactions policy check failed. Refresh and retry. No transactions were changed.',
  }
}
