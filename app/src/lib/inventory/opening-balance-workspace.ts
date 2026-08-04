// ============================================================================
// Opening Balance cut-off — presentation-layer grouping & wizard step logic.
// ----------------------------------------------------------------------------
// PURE, UI-agnostic helpers that reshape the flat, line-level `inventory_cutoff_preview`
// payload into the grouped, guided five-step workspace the operator drives.
//
// This module NEVER mutates data, never calls an RPC and never changes an
// eligibility, classification, quantity or posting rule. Every actionable /
// eligibility test delegates to the Phase 1/2 source of truth in
//   ./opening-balance-classification.ts
// and the readiness ("Ready" / "Blocked") remains whatever the server reported.
// Grouping is done here only so the UI can show one card per order instead of
// one row per line — exactly the "group line-level data in the presentation
// layer" the task calls for, with no migration and no server change.
// ============================================================================

import {
  distributorDecisionEligibility,
  isManufacturerIncomingEligible,
  manufacturerDecisionOptions,
  summarizeOpeningBalance,
  type DistributorDecision,
  type DistributorOrderStatus,
  type D2hOpeningBalancePolicy,
  type ManufacturerDecision,
  type OpeningBalancePreview,
  type OpeningBalanceSummary,
} from './opening-balance-classification'
import {
  isD2hPolicyResolved,
  type D2hHistoricalSummary,
  type D2hPolicySnapshot,
} from './opening-balance-d2h-policy'
import {
  isH2mPolicyResolved,
  type H2mHistoricalSummary,
  type H2mPolicySnapshot,
} from './opening-balance-h2m-policy'
import {
  isTransactionsPolicyResolved,
  type TransactionRef,
  type TransactionsHistoricalSummary,
  type TransactionsPolicySnapshot,
} from './opening-balance-transactions-policy'
import {
  orphanAllocationBlockers,
  parseOpeningBalanceBlockers,
  type OpeningBalanceBlockerDetail,
} from './opening-balance-blockers'

// ---------------------------------------------------------------------------
// Wizard steps
// ---------------------------------------------------------------------------

export const OPENING_BALANCE_STEPS = [
  { id: 'freeze', label: 'Freeze & Overview', short: 'Freeze' },
  { id: 'd2h', label: 'Resolve D2H Orders', short: 'D2H' },
  { id: 'h2m', label: 'Resolve H2M Incoming', short: 'H2M' },
  { id: 'transactions', label: 'Review Transactions', short: 'Transactions' },
  { id: 'review', label: 'Final Review & Post', short: 'Review & Post' },
] as const

export type OpeningBalanceStepId = (typeof OPENING_BALANCE_STEPS)[number]['id']

// Short, action-oriented destination names for the single primary "Continue"
// action in the wizard footer. Keyed by the step being navigated TO so the
// button always advertises where the next click lands.
const OPENING_BALANCE_DESTINATION_LABEL: Record<OpeningBalanceStepId, string> = {
  freeze: 'Overview',
  d2h: 'D2H Orders',
  h2m: 'H2M Incoming',
  transactions: 'Transactions',
  review: 'Review & Post',
}

/**
 * Label for the wizard's single forward action from `current`. Returns the
 * destination-aware "Continue to …" text, or `null` on the final step (where
 * the primary action becomes "Request OTP & Post" instead of a navigation).
 */
export function openingBalanceContinueLabel(current: OpeningBalanceStepId): string | null {
  const index = OPENING_BALANCE_STEPS.findIndex(s => s.id === current)
  const next = OPENING_BALANCE_STEPS[index + 1]
  if (!next) return null
  return `Continue to ${OPENING_BALANCE_DESTINATION_LABEL[next.id]}`
}

export type OpeningBalanceReadinessStatus = 'Ready' | 'Action Required' | 'Blocked' | 'Completed'

// ---------------------------------------------------------------------------
// Row shapes (a faithful, minimal view of the preview payload)
// ---------------------------------------------------------------------------

export interface DistributorLine {
  order_item_id?: string
  order_id?: string
  order_number?: string
  status: DistributorOrderStatus | string
  customer?: string
  warehouse?: string
  /** Variant id — used only to look up read-only Carry Forward eligibility. */
  variant_id?: string
  variant?: string
  quantity?: number
  classification?: string
  decision?: DistributorDecision | null
  order_created_at?: string | null
  has_active_allocation?: boolean
  has_order_fulfillment?: boolean
  product_category_id?: string
}

export interface ManufacturerLine {
  order_item_id?: string
  order_id?: string
  order_number?: string
  variant_id?: string
  status?: string
  manufacturer?: string
  variant?: string
  ordered_quantity?: number
  received_quantity?: number
  remaining_incoming_quantity?: number
  stock_configuration?: string | null
  stock_config_id?: string | null
  decision?: ManufacturerDecision | null
  /** Authoritative order timestamp supplied by the server preview. */
  order_created_at?: string | null
  /** Numeric document sequence (`orders.base_seq`) used as a stable tie-breaker. */
  order_sequence?: number | null
}

export interface WarehouseActivityItem {
  item_id?: string | null
  variant_id?: string | null
  variant_name?: string | null
  alternative_name?: string | null
  stock_config_id?: string | null
  stock_configuration?: string | null
  quantity?: number | null
  warehouse?: string | null
  status?: string | null
}

export interface WarehouseActivityLine {
  movement_type?: string
  /** Business document/reference number when one already exists (transfer_no, return_no, …). */
  reference_no?: string | null
  /** Internal UUID retained for joins, API actions, audit and uniqueness. */
  reference_id?: string | null
  reference_type?: string | null
  status?: string | null
  quantity?: number
  /** Authoritative non-zero child-line count when the server provided detail. */
  line_count?: number | null
  variant_count?: number | null
  classification?: string
  required_action?: string | null
  warehouse?: string | null
  occurred_at?: string
  /** Child lines under this transaction header — never group by timestamp alone. */
  items?: WarehouseActivityItem[] | null
}

// ---------------------------------------------------------------------------
// D2H grouping
// ---------------------------------------------------------------------------

export interface DistributorOrderGroup {
  /** Stable grouping key — never a raw UUID when an order number exists. */
  key: string
  /** Immutable server order id used by Option B selection. */
  orderId: string
  orderNumber: string
  customer: string
  warehouse: string
  /** Distinct statuses present in the order, stable-sorted. */
  statuses: string[]
  lineCount: number
  totalQuantity: number
  /** True when at least one line is a `submitted` order accepting a decision. */
  actionable: boolean
  /** Submitted lines that still have no recorded decision. */
  decisionsRemaining: number
  /** Line-level blockers (undecided submitted / server "Blocked" classification). */
  hasBlocker: boolean
  lines: DistributorLine[]
}

export interface DistributorGroupDecisionState {
  /** Selected only when every eligible submitted line has this saved decision. */
  appliedDecision: DistributorDecision | null
  /** True when eligible lines contain more than one distinct saved decision. */
  mixed: boolean
}

const stableKey = (orderNumber?: string, fallback?: string) =>
  (orderNumber && orderNumber.trim()) || (fallback && fallback.trim()) || 'unknown'

const distinctStable = (values: (string | undefined)[]): string[] =>
  Array.from(new Set(values.filter((v): v is string => Boolean(v)))).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )

/**
 * Group flat D2H lines by order. An order is *actionable* only when it contains
 * a `submitted` line — the single status that `set_inventory_cutoff_decision`
 * accepts a decision for. Everything else (closed, cancelled, shipped/in-transit,
 * approved/packed) is non-actionable and belongs in the collapsed history list.
 * Groups keep a stable order (actionable first, then by order number) so cards
 * never reorder across preview refreshes.
 */
export function groupDistributorOrders(rows: DistributorLine[]): {
  actionable: DistributorOrderGroup[]
  historical: DistributorOrderGroup[]
} {
  const byKey = new Map<string, DistributorLine[]>()
  for (const row of rows) {
    const key = stableKey(row.order_number, row.order_id ?? row.order_item_id)
    const bucket = byKey.get(key)
    if (bucket) bucket.push(row)
    else byKey.set(key, [row])
  }

  const groups: DistributorOrderGroup[] = []
  for (const [key, lines] of byKey) {
    const actionable = lines.some(line => line.status === 'submitted')
    const decisionsRemaining = lines.filter(
      line => line.status === 'submitted' && !line.decision,
    ).length
    const hasBlocker = lines.some(
      line =>
        (line.status === 'submitted' && !line.decision) ||
        line.classification === 'Blocked',
    )
    groups.push({
      key,
      orderId: lines.find(l => l.order_id)?.order_id ?? '',
      orderNumber: lines[0]?.order_number?.trim() || key,
      customer: lines.find(l => l.customer)?.customer?.trim() || '—',
      warehouse: lines.find(l => l.warehouse)?.warehouse?.trim() || '—',
      statuses: distinctStable(lines.map(l => l.status as string)),
      lineCount: lines.length,
      totalQuantity: lines.reduce((sum, l) => sum + Number(l.quantity || 0), 0),
      actionable,
      decisionsRemaining,
      hasBlocker,
      lines,
    })
  }

  const byOrderNumber = (a: DistributorOrderGroup, b: DistributorOrderGroup) =>
    a.orderNumber < b.orderNumber ? -1 : a.orderNumber > b.orderNumber ? 1 : 0

  return {
    actionable: groups.filter(g => g.actionable).sort(byOrderNumber),
    historical: groups.filter(g => !g.actionable).sort(byOrderNumber),
  }
}

/**
 * The order-item ids a D2H order-level / bulk decision may legally touch: only
 * `submitted` lines. Never returns an ineligible (in-transit, closed, approved)
 * line, so an order-level action can never override a line the server would
 * reject. Mirrors `distributorDecisionEligibility(status).actionable`.
 */
export function distributorBulkTargets(lines: DistributorLine[]): string[] {
  return lines
    .filter(
      line =>
        distributorDecisionEligibility(line.status as DistributorOrderStatus).actionable &&
        line.order_item_id,
    )
    .map(line => line.order_item_id as string)
}

/**
 * Derive the order-level presentation strictly from decisions returned by
 * `inventory_cutoff_preview`. A partially decided order is not represented as
 * uniformly selected, and different saved line decisions are explicitly mixed.
 */
export function distributorGroupDecisionState(
  lines: DistributorLine[],
): DistributorGroupDecisionState {
  const eligible = lines.filter(line =>
    distributorDecisionEligibility(line.status as DistributorOrderStatus).actionable,
  )
  const saved = eligible
    .map(line => line.decision)
    .filter((decision): decision is DistributorDecision => Boolean(decision))
  const distinct = new Set(saved)

  return {
    appliedDecision:
      eligible.length > 0 && saved.length === eligible.length && distinct.size === 1
        ? saved[0]
        : null,
    mixed: distinct.size > 1,
  }
}

// ---------------------------------------------------------------------------
// H2M grouping
// ---------------------------------------------------------------------------

export interface ManufacturerOrderGroup {
  key: string
  /** Immutable server order id used by authoritative bulk operations. */
  orderId: string
  orderNumber: string
  manufacturer: string
  statuses: string[]
  lineCount: number
  orderedQuantity: number
  receivedQuantity: number
  remainingIncoming: number
  /** Eligible lines that still have no recorded decision. */
  decisionsRemaining: number
  /** Eligible lines whose carry-forward target configuration is missing. */
  configIssues: number
  orderCreatedAt: string | null
  orderSequence: number | null
  lines: ManufacturerLine[]
}

const manufacturerLineEligible = (line: ManufacturerLine): boolean => {
  // Prefer explicit ordered/received when present; otherwise trust the remaining
  // quantity the preview already computed (the preview only surfaces > 0 rows).
  if (line.ordered_quantity != null || line.received_quantity != null) {
    return isManufacturerIncomingEligible({
      status: line.status ?? '',
      orderedQty: Number(line.ordered_quantity || 0),
      receivedQty: Number(line.received_quantity || 0),
    })
  }
  return Number(line.remaining_incoming_quantity || 0) > 0
}

/**
 * Group flat H2M lines by manufacturer order. Aggregates ordered / received /
 * remaining incoming and counts unresolved decisions and configuration issues
 * without changing the per-line remaining-quantity calculation.
 */
export function groupManufacturerOrders(rows: ManufacturerLine[]): ManufacturerOrderGroup[] {
  const byKey = new Map<string, ManufacturerLine[]>()
  for (const row of rows) {
    const key = stableKey(row.order_number, row.order_id ?? row.order_item_id)
    const bucket = byKey.get(key)
    if (bucket) bucket.push(row)
    else byKey.set(key, [row])
  }

  const groups: ManufacturerOrderGroup[] = []
  for (const [key, lines] of byKey) {
    const decisionsRemaining = lines.filter(
      line => manufacturerLineEligible(line) && !line.decision,
    ).length
    const configIssues = lines.filter(
      line => manufacturerLineEligible(line) && !line.stock_config_id,
    ).length
    groups.push({
      key,
      orderId: lines.find(l => l.order_id)?.order_id ?? '',
      orderNumber: lines[0]?.order_number?.trim() || key,
      manufacturer: lines.find(l => l.manufacturer)?.manufacturer?.trim() || '—',
      statuses: distinctStable(lines.map(l => l.status)),
      lineCount: lines.length,
      orderedQuantity: lines.reduce((s, l) => s + Number(l.ordered_quantity || 0), 0),
      receivedQuantity: lines.reduce((s, l) => s + Number(l.received_quantity || 0), 0),
      remainingIncoming: lines.reduce((s, l) => s + Number(l.remaining_incoming_quantity || 0), 0),
      decisionsRemaining,
      configIssues,
      orderCreatedAt: lines.find(l => l.order_created_at)?.order_created_at ?? null,
      orderSequence: lines.find(l => l.order_sequence != null)?.order_sequence ?? null,
      lines,
    })
  }

  return groups.sort((a, b) => {
    const aTime = a.orderCreatedAt ? Date.parse(a.orderCreatedAt) : Number.NEGATIVE_INFINITY
    const bTime = b.orderCreatedAt ? Date.parse(b.orderCreatedAt) : Number.NEGATIVE_INFINITY
    if (aTime !== bTime) return bTime - aTime

    const aSequence = a.orderSequence ?? Number.NEGATIVE_INFINITY
    const bSequence = b.orderSequence ?? Number.NEGATIVE_INFINITY
    if (aSequence !== bSequence) return bSequence - aSequence

    // Normal previews arrive in the server's UUID-descending order. This
    // fallback also keeps independently constructed client fixtures stable.
    return a.key < b.key ? 1 : a.key > b.key ? -1 : 0
  })
}

/**
 * The order-item ids an H2M bulk decision may legally update, given the intended
 * decision. `carry_forward_incoming` requires a present configuration (blocked
 * lines are excluded, never silently overwritten); `history_only` is allowed for
 * every eligible line. Mirrors `manufacturerDecisionOptions`.
 */
export function manufacturerBulkTargets(
  lines: ManufacturerLine[],
  decision: ManufacturerDecision,
): string[] {
  return lines
    .filter(line => {
      if (!manufacturerLineEligible(line) || !line.order_item_id) return false
      const options = manufacturerDecisionOptions({ stockConfigId: line.stock_config_id })
      return decision === 'carry_forward_incoming'
        ? options.canCarryForwardIncoming
        : options.canHistoryOnly
    })
    .map(line => line.order_item_id as string)
}

// ---------------------------------------------------------------------------
// Operational transactions (step 4)
// ---------------------------------------------------------------------------

export type ActivityBucket = 'mustResolve' | 'safe' | 'history'

const HISTORY_ACTIVITY_STATUSES = new Set([
  'posted',
  'completed',
  'closed',
  'cancelled',
  'done',
  // Quality-issue / complaint tickets close as resolved/rejected without
  // becoming inventory `completed`; they must not block Opening Balance.
  'resolved',
  'rejected',
])

/**
 * Bucket a warehouse activity row for the "Other Transactions" step. Genuine
 * blockers ("Must Resolve Before Cut-off") are open/pending transactions; a
 * Stock-in-Transit row is protected and non-blocking; posted/completed/cancelled
 * (and closed quality-issue) rows are history only. This is a *presentation*
 * split — readiness stays server-authoritative.
 */
export function classifyActivityBucket(row: WarehouseActivityLine): ActivityBucket {
  if (row.classification === 'Stock in Transit') return 'safe'
  if (row.classification === 'History Only') return 'history'
  const status = (row.status || 'posted').toLowerCase()
  if (HISTORY_ACTIVITY_STATUSES.has(status)) return 'history'
  return 'mustResolve'
}

export interface ActivityGroups {
  mustResolve: WarehouseActivityLine[]
  safe: WarehouseActivityLine[]
  history: WarehouseActivityLine[]
}

export function groupWarehouseActivity(rows: WarehouseActivityLine[]): ActivityGroups {
  const groups: ActivityGroups = { mustResolve: [], safe: [], history: [] }
  for (const row of rows) groups[classifyActivityBucket(row)].push(row)
  return groups
}

// ---------------------------------------------------------------------------
// Step readiness derivation (drives the progress bar, blocker chips & CTA)
// ---------------------------------------------------------------------------

export interface OpeningBalanceWorkspaceState {
  summary: OpeningBalanceSummary
  physicalQuantity: number
  /** Undecided D2H policy / Option B lines. Zero once a policy snapshot is saved under Option A. */
  d2hRemaining: number
  /** Undecided eligible H2M lines. */
  h2mRemaining: number
  /** Blocking operational transactions requiring attention. */
  transactionsRemaining: number
  /** Total unresolved blockers surfaced anywhere. */
  totalBlockers: number
  status: OpeningBalanceReadinessStatus
  /** Per-step "decisions remaining" count, keyed by step id. */
  remainingByStep: Record<OpeningBalanceStepId, number>
  d2hPolicy: D2hPolicySnapshot | null
  d2hHistoricalSummary: D2hHistoricalSummary | null
  h2mPolicy: H2mPolicySnapshot | null
  h2mHistoricalSummary: H2mHistoricalSummary | null
  transactionsPolicy: TransactionsPolicySnapshot | null
  transactionsHistoricalSummary: TransactionsHistoricalSummary | null
  /** Structured, authoritative blocker collection shared by Step 4 & Step 5. */
  blockerDetails: OpeningBalanceBlockerDetail[]
  /**
   * Allocation/orphan reconciliation blockers whose resolution home is Step 4
   * but which have no typed transaction row — the ones the old contract hid.
   */
  allocationBlockers: OpeningBalanceBlockerDetail[]
}

interface DeriveInput extends OpeningBalancePreview {
  status?: 'counting' | 'posted' | 'cancelled'
  blocker_details?: unknown
  d2h_policy?: D2hPolicySnapshot | Record<string, unknown> | null
  d2h_historical_summary?: D2hHistoricalSummary | Record<string, unknown> | null
  h2m_policy?: H2mPolicySnapshot | Record<string, unknown> | null
  h2m_historical_summary?: H2mHistoricalSummary | Record<string, unknown> | null
  transactions_policy?: TransactionsPolicySnapshot | Record<string, unknown> | null
  transactions_historical_summary?: TransactionsHistoricalSummary | Record<string, unknown> | null
}

function coerceD2hPolicy(value: DeriveInput['d2h_policy']): D2hPolicySnapshot | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const policy = row.policy
  if (policy !== 'exclude_all' && policy !== 'review_select') return null
  const asNumber = (key: string) => {
    const n = Number(row[key] ?? 0)
    return Number.isFinite(n) ? n : 0
  }
  const asIds = (key: string) =>
    Array.isArray(row[key]) ? row[key].filter((id): id is string => typeof id === 'string') : []
  return {
    policy,
    boundaryAt: typeof row.boundary_at === 'string' ? row.boundary_at : '',
    eligibleOrderCount: asNumber('eligible_order_count'),
    eligibleItemCount: asNumber('eligible_item_count'),
    eligibleQuantity: asNumber('eligible_quantity'),
    selectedOrderCount: asNumber('selected_order_count'),
    selectedItemCount: asNumber('selected_item_count'),
    selectedQuantity: asNumber('selected_quantity'),
    excludedOrderCount: asNumber('excluded_order_count'),
    excludedItemCount: asNumber('excluded_item_count'),
    excludedQuantity: asNumber('excluded_quantity'),
    eligibleOrderIds: asIds('eligible_order_ids'),
    selectedOrderIds: asIds('selected_order_ids'),
    excludedOrderIds: asIds('excluded_order_ids'),
    ordersCancelled: false,
    historicalMovementsReversed: false,
    qrImpact: 'none',
  }
}

function coerceD2hHistoricalSummary(
  value: DeriveInput['d2h_historical_summary'],
): D2hHistoricalSummary | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  return {
    orderCount: Number(row.order_count || 0),
    itemCount: Number(row.item_count || 0),
    orderedQuantity: Number(row.ordered_quantity || 0),
    ordersCancelled: false,
    historicalStockReturned: false,
    notice: typeof row.notice === 'string' ? row.notice : null,
  }
}

function coerceH2mPolicy(value: DeriveInput['h2m_policy']): H2mPolicySnapshot | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const policy = row.policy
  if (policy !== 'exclude_all' && policy !== 'review_select') return null
  const asNumber = (key: string) => {
    const n = Number(row[key] ?? 0)
    return Number.isFinite(n) ? n : 0
  }
  const asIds = (key: string) =>
    Array.isArray(row[key]) ? row[key].filter((id): id is string => typeof id === 'string') : []
  const outstanding = asNumber('eligible_outstanding_quantity') || asNumber('eligible_quantity')
  const selectedOutstanding = asNumber('selected_outstanding_quantity') || asNumber('selected_quantity')
  const excludedOutstanding = asNumber('excluded_outstanding_quantity') || asNumber('excluded_quantity')
  return {
    policy,
    boundaryAt: typeof row.boundary_at === 'string' ? row.boundary_at : '',
    eligibleOrderCount: asNumber('eligible_order_count'),
    eligibleItemCount: asNumber('eligible_item_count'),
    eligibleQuantity: outstanding,
    eligibleOrderedQuantity: asNumber('eligible_ordered_quantity'),
    eligibleReceivedBeforeBoundary: asNumber('eligible_received_before_boundary'),
    eligibleOutstandingQuantity: outstanding,
    selectedOrderCount: asNumber('selected_order_count'),
    selectedItemCount: asNumber('selected_item_count'),
    selectedQuantity: selectedOutstanding,
    selectedOrderedQuantity: asNumber('selected_ordered_quantity'),
    selectedReceivedBeforeBoundary: asNumber('selected_received_before_boundary'),
    selectedOutstandingQuantity: selectedOutstanding,
    excludedOrderCount: asNumber('excluded_order_count'),
    excludedItemCount: asNumber('excluded_item_count'),
    excludedQuantity: excludedOutstanding,
    excludedOrderedQuantity: asNumber('excluded_ordered_quantity'),
    excludedReceivedBeforeBoundary: asNumber('excluded_received_before_boundary'),
    excludedOutstandingQuantity: excludedOutstanding,
    eligibleOrderIds: asIds('eligible_order_ids'),
    selectedOrderIds: asIds('selected_order_ids'),
    excludedOrderIds: asIds('excluded_order_ids'),
    ordersCancelled: false,
    inventoryAdded: false,
    historicalMovementsReversed: false,
    qrImpact: 'none',
  }
}

function coerceH2mHistoricalSummary(
  value: DeriveInput['h2m_historical_summary'],
): H2mHistoricalSummary | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  return {
    orderCount: Number(row.order_count || 0),
    itemCount: Number(row.item_count || 0),
    orderedQuantity: Number(row.ordered_quantity || 0),
    receivedBeforeBoundary: Number(row.received_before_boundary || 0),
    outstandingQuantity: Number(row.outstanding_quantity || 0),
    ordersCancelled: false,
    inventoryAdded: false,
    notice: typeof row.notice === 'string' ? row.notice : null,
  }
}

const asRefs = (value: unknown): TransactionRef[] => {
  if (!Array.isArray(value)) return []
  const refs: TransactionRef[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const type = row.type
    const id = row.id
    if (
      (type === 'stock_adjustment' || type === 'return' || type === 'stock_transfer')
      && typeof id === 'string'
    ) {
      refs.push({ type, id })
    }
  }
  return refs
}

function coerceTransactionsPolicy(
  value: DeriveInput['transactions_policy'],
): TransactionsPolicySnapshot | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const policy = row.policy
  if (policy !== 'exclude_all' && policy !== 'carry_forward_all' && policy !== 'review_select') {
    return null
  }
  const asNumber = (key: string) => {
    const n = Number(row[key] ?? 0)
    return Number.isFinite(n) ? n : 0
  }
  const asIds = (key: string) =>
    Array.isArray(row[key]) ? row[key].filter((id): id is string => typeof id === 'string') : []
  return {
    policy,
    boundaryAt: typeof row.boundary_at === 'string' ? row.boundary_at : '',
    warehouseOrganizationId:
      typeof row.warehouse_organization_id === 'string' ? row.warehouse_organization_id : undefined,
    companyId: typeof row.company_id === 'string' ? row.company_id : undefined,
    productCategoryId:
      typeof row.product_category_id === 'string' ? row.product_category_id : undefined,
    eligibleCount: asNumber('eligible_count'),
    carriedCount: asNumber('carried_count'),
    excludedCount: asNumber('excluded_count'),
    blockedCount: asNumber('blocked_count'),
    carriedAdjustmentIds: asIds('carried_adjustment_ids'),
    carriedReturnIds: asIds('carried_return_ids'),
    carriedTransferIds: asIds('carried_transfer_ids'),
    excludedAdjustmentIds: asIds('excluded_adjustment_ids'),
    excludedReturnIds: asIds('excluded_return_ids'),
    excludedTransferIds: asIds('excluded_transfer_ids'),
    carriedRefs: asRefs(row.carried_refs),
    excludedRefs: asRefs(row.excluded_refs),
    eligibleRefs: asRefs(row.eligible_refs),
    decidedBy: typeof row.decided_by === 'string' ? row.decided_by : undefined,
    decidedAt: typeof row.decided_at === 'string' ? row.decided_at : undefined,
    confirmationFingerprint:
      typeof row.confirmation_fingerprint === 'string' ? row.confirmation_fingerprint : undefined,
    inventoryImpact: 0,
    transactionsCancelled: false,
    stockMovementsCreated: false,
    qrImpact: 'none',
  }
}

function coerceTransactionsHistoricalSummary(
  value: DeriveInput['transactions_historical_summary'],
): TransactionsHistoricalSummary | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  return {
    eligibleCount: Number(row.eligible_count || 0),
    carriedCount: Number(row.carried_count || 0),
    excludedCount: Number(row.excluded_count || 0),
    blockedCount: Number(row.blocked_count || 0),
    inventoryImpact: 0,
    transactionsCancelled: false,
    notice: typeof row.notice === 'string' ? row.notice : null,
  }
}

/**
 * Derive the guided-workspace state from a read-only preview. `readiness` is the
 * server's word and is never re-computed; the per-step remaining counts are
 * purely for guidance (Resolve D2H — n, Resolve H2M — n, …).
 */
export function deriveWorkspaceState(preview: DeriveInput): OpeningBalanceWorkspaceState {
  const summary = summarizeOpeningBalance(preview)
  const d2hPolicy = coerceD2hPolicy(preview.d2h_policy)
  const d2hHistoricalSummary = coerceD2hHistoricalSummary(preview.d2h_historical_summary)
  const h2mPolicy = coerceH2mPolicy(preview.h2m_policy)
  const h2mHistoricalSummary = coerceH2mHistoricalSummary(preview.h2m_historical_summary)
  const transactionsPolicy = coerceTransactionsPolicy(preview.transactions_policy)
  const transactionsHistoricalSummary =
    coerceTransactionsHistoricalSummary(preview.transactions_historical_summary)

  const distributor = (preview.distributor_orders ?? []) as DistributorLine[]
  const manufacturer = (preview.manufacturer_incoming ?? []) as ManufacturerLine[]
  const activity = (preview.warehouse_activity ?? []) as WarehouseActivityLine[]

  // Option A: policy save resolves Step 2. Option B: remaining submitted lines
  // without a decision still need review. No policy yet → one policy decision.
  const d2hRemaining = !isD2hPolicyResolved(d2hPolicy)
    ? (distributor.length > 0 ? 1 : 0)
    : d2hPolicy?.policy === 'exclude_all'
      ? 0
      : distributor.filter(l => l.status === 'submitted' && !l.decision && l.has_active_allocation !== false).length

  // Option A: policy save resolves Step 3. Option B: undecided eligible lines.
  // No policy yet with eligible H2M → one policy decision remaining.
  const h2mRemaining = !isH2mPolicyResolved(h2mPolicy)
    ? (manufacturer.filter(l => manufacturerLineEligible(l)).length > 0 ? 1 : 0)
    : h2mPolicy?.policy === 'exclude_all'
      ? 0
      : manufacturer.filter(l => manufacturerLineEligible(l) && !l.decision).length
  // Prefer the authoritative Transactions policy signal when the server provided
  // it: an unsaved policy with eligible transactions needs one decision, plus any
  // genuine Requires-Individual-Resolution blockers. Otherwise fall back to the
  // legacy blocker-only count so pre-migration previews still guide the operator.
  // Authoritative blocker collection (structured contract, else classified
  // strings). Allocation/orphan reconciliation blockers resolve in Step 4 but
  // are absent from the typed transaction list / blocked_count — so they must be
  // added to the Step 4 remaining count. Otherwise Step 4 shows "All resolved"
  // while Review & Post still reports the blocker (the reported contradiction).
  const blockerDetails = parseOpeningBalanceBlockers({
    blocker_details: preview.blocker_details,
    blockers: preview.blockers,
  })
  const allocationBlockers = orphanAllocationBlockers(blockerDetails)

  const transactionsRemaining = (transactionsHistoricalSummary
    ? (isTransactionsPolicyResolved(transactionsPolicy) ? 0
        : (transactionsHistoricalSummary.eligibleCount > 0 ? 1 : 0))
      + transactionsHistoricalSummary.blockedCount
    : activity.filter(row => classifyActivityBucket(row) === 'mustResolve').length)
    + allocationBlockers.length

  const totalBlockers = summary.blocked.orderCount + summary.blocked.messages.length

  let status: OpeningBalanceReadinessStatus
  if (preview.status === 'posted') status = 'Completed'
  else if (preview.readiness === 'Ready') status = 'Ready'
  else if (preview.readiness === 'Blocked') status = 'Blocked'
  else status = 'Action Required'

  return {
    summary,
    physicalQuantity: summary.physicalOpeningStock.totalQuantity,
    d2hRemaining,
    h2mRemaining,
    transactionsRemaining,
    totalBlockers,
    status,
    remainingByStep: {
      freeze: 0,
      d2h: d2hRemaining,
      h2m: h2mRemaining,
      transactions: transactionsRemaining,
      review: d2hRemaining + h2mRemaining + transactionsRemaining,
    },
    d2hPolicy,
    d2hHistoricalSummary,
    h2mPolicy,
    h2mHistoricalSummary,
    transactionsPolicy,
    transactionsHistoricalSummary,
    blockerDetails,
    allocationBlockers,
  }
}

/** Presentation helpers for Option B order cards. */
export type D2hReviewOrderAction = 'carry_forward' | 'do_not_carry_forward'

export function d2hReviewActionLabel(decision: D2hReviewOrderAction): string {
  return decision === 'carry_forward'
    ? 'Carry Into New Inventory'
    : 'Keep as Historical'
}

export function d2hPolicyLabel(policy: D2hOpeningBalancePolicy): string {
  return policy === 'exclude_all'
    ? 'Start Fresh — Exclude All Existing D2H Orders'
    : 'Review Orders to Carry Into New Inventory'
}

export type WorkspaceFilter = 'all' | 'action' | 'resolved' | 'blocked'

/** Case-insensitive match of an order group against a free-text search term. */
export function matchesSearch(
  fields: (string | undefined | null)[],
  term: string,
): boolean {
  const q = term.trim().toLowerCase()
  if (!q) return true
  return fields.some(field => (field || '').toLowerCase().includes(q))
}
