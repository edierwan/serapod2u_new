// ============================================================================
// Opening Balance cut-off classification, decision & summary logic (pure).
// ----------------------------------------------------------------------------
// One UI-agnostic source of truth for how existing H2M (manufacturer → HQ) and
// D2H (distributor → HQ) orders are classified and decided at an Inventory
// Opening Balance cut-off, and how the seven pre-posting summary buckets are
// derived from the server preview payload.
//
// These functions deliberately MIRROR — never replace — the server rules in
//   supabase/migrations/20260726_inventory_opening_balance_cutoff/
//     02_cutoff_preview_and_decisions.sql   (classification + decision guards)
//     03_cutoff_atomic_posting.sql          (atomic, idempotent posting)
// The database RPCs remain the only mutation authority and re-validate every
// order, quantity and configuration under row locks inside the posting
// transaction. This module lets the client show a faithful preview/summary and
// refuse a post the server would reject, without ever performing a mutation,
// touching QR data, or trusting a client-supplied quantity.
// ============================================================================

// ---------------------------------------------------------------------------
// A1. H2M — Incoming classification
// ---------------------------------------------------------------------------

export const H2M_INCOMING_ELIGIBLE_STATUSES = ['approved', 'closed'] as const
export type ManufacturerOrderStatus = string

export type ManufacturerDecision = 'carry_forward_incoming' | 'history_only'

/**
 * Remaining outstanding incoming = ordered − already received, never negative.
 * Fully received lines return 0 and are therefore not incoming.
 */
export function manufacturerRemainingIncoming(orderedQty: number, receivedQty: number): number {
  return Math.max(Number(orderedQty || 0) - Number(receivedQty || 0), 0)
}

export interface ManufacturerLineInput {
  status: ManufacturerOrderStatus
  orderedQty: number
  receivedQty: number
}

/**
 * An H2M line is eligible for a cut-off incoming decision only while it is an
 * approved/closed order with a genuine outstanding remaining quantity.
 * Cancelled / draft / fully-received lines are never eligible. Mirrors the
 * preview's `where x.remaining_qty > 0` + `o.status in ('approved','closed')`.
 */
export function isManufacturerIncomingEligible(line: ManufacturerLineInput): boolean {
  return (H2M_INCOMING_ELIGIBLE_STATUSES as readonly string[]).includes(line.status)
    && manufacturerRemainingIncoming(line.orderedQty, line.receivedQty) > 0
}

export interface ManufacturerDecisionOptions {
  /** "Carry Forward as Incoming" needs a resolved active allow_ord configuration. */
  canCarryForwardIncoming: boolean
  /** "History Only" (close the H2M lifecycle) is always available for an eligible line. */
  canHistoryOnly: boolean
  /** Reason the carry-forward option is disabled, or null when it is allowed. */
  carryForwardBlockedReason: string | null
}

/**
 * The decisions a user may pick for an eligible H2M line. Carry Forward as
 * Incoming requires the order item to still carry an active allow_ord stock
 * configuration; otherwise it is blocked (never silently substituted).
 */
export function manufacturerDecisionOptions(line: {
  stockConfigId: string | null | undefined
}): ManufacturerDecisionOptions {
  const hasConfig = Boolean(line.stockConfigId)
  return {
    canCarryForwardIncoming: hasConfig,
    canHistoryOnly: true,
    carryForwardBlockedReason: hasConfig
      ? null
      : 'Selected stock configuration is missing — carry-forward as incoming is blocked.',
  }
}

// ---------------------------------------------------------------------------
// A2. D2H — Existing distributor order classification
// ---------------------------------------------------------------------------

export type DistributorOrderStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'warehouse_packed'
  | 'shipped_distributor'
  | 'closed'
  | 'cancelled'

export type DistributorDecision = 'carry_forward' | 'cancel_release' | 'do_not_carry_forward'

/** Cutoff-level D2H policy (primary decision). Per-order cancel_release is not exposed. */
export type D2hOpeningBalancePolicy = 'exclude_all' | 'review_select'

/** Option B per-order choices after a review_select policy is active. */
export type D2hReviewOrderDecision = 'carry_forward' | 'do_not_carry_forward'

export interface DistributorEligibility {
  /** Only a `submitted` order accepts an explicit cut-off decision. */
  actionable: boolean
  /**
   * Actions offered under Option B review. Cancel & Release is intentionally
   * omitted — cancellation stays in the original order workflow.
   */
  availableActions: D2hReviewOrderDecision[]
  /** True only where the current status legally allows cancellation elsewhere. */
  cancellable: boolean
  /** Default classification bucket when no decision has been recorded yet. */
  defaultClassification: DistributorClassification
}

export type DistributorClassification =
  | 'Carry Forward'
  | 'Cancel & Release'
  | 'Do Not Carry Forward'
  | 'Historical Excluded'
  | 'Stock in Transit'
  | 'Complete Before Cut-off'
  | 'History Only'
  | 'Blocked'

/**
 * Status → decision eligibility under Option B (review select).
 * Option A never requires per-order actions — exclude_all covers them.
 */
export function distributorDecisionEligibility(status: DistributorOrderStatus): DistributorEligibility {
  if (status === 'submitted') {
    return {
      actionable: true,
      availableActions: ['carry_forward', 'do_not_carry_forward'],
      cancellable: true,
      defaultClassification: 'Blocked', // undecided submitted order blocks posting under Option B
    }
  }
  const defaultClassification: DistributorClassification =
    status === 'shipped_distributor' ? 'Stock in Transit'
    : status === 'closed' || status === 'cancelled' ? 'History Only'
    : status === 'approved' || status === 'warehouse_packed' ? 'Complete Before Cut-off'
    : 'Complete Before Cut-off' // draft (only surfaces if it has real stock movements)
  return { actionable: false, availableActions: [], cancellable: false, defaultClassification }
}

/**
 * Final displayed classification for a distributor row given its recorded
 * decision (if any) and optional cutoff-level D2H policy.
 */
export function distributorClassification(
  status: DistributorOrderStatus,
  decision: DistributorDecision | null | undefined,
  policy?: D2hOpeningBalancePolicy | null,
): DistributorClassification {
  if (status === 'submitted') {
    if (decision === 'carry_forward') return 'Carry Forward'
    if (decision === 'cancel_release') return 'Cancel & Release'
    if (decision === 'do_not_carry_forward') return 'Do Not Carry Forward'
    if (policy === 'exclude_all') return 'Historical Excluded'
    return 'Blocked'
  }
  if (
    policy
    && (status === 'approved' || status === 'warehouse_packed' || status === 'closed' || status === 'cancelled')
  ) {
    if (status === 'closed' || status === 'cancelled') return 'History Only'
    return 'Historical Excluded'
  }
  return distributorDecisionEligibility(status).defaultClassification
}

// ---------------------------------------------------------------------------
// A3. Pre-posting summary — the seven required buckets
// ---------------------------------------------------------------------------

export interface OpeningBalancePreviewInventoryRow {
  variant_id?: string
  variant_name?: string
  stock_config_id?: string
  physical_quantity?: number | null
}

export interface OpeningBalancePreviewDistributorRow {
  order_id?: string
  order_number?: string
  status: DistributorOrderStatus | string
  quantity?: number
  decision?: DistributorDecision | null
  classification?: string
}

export interface OpeningBalancePreviewManufacturerRow {
  order_id?: string
  order_number?: string
  status?: string
  remaining_incoming_quantity?: number
  stock_config_id?: string | null
  decision?: ManufacturerDecision | null
  classification?: string
}

export interface OpeningBalancePreviewActivityRow {
  movement_type?: string
  reference_no?: string | null
  status?: string | null
  classification?: string
}

export interface OpeningBalancePreview {
  readiness?: 'Ready' | 'Review Required' | 'Blocked'
  inventory?: OpeningBalancePreviewInventoryRow[]
  distributor_orders?: OpeningBalancePreviewDistributorRow[]
  manufacturer_incoming?: OpeningBalancePreviewManufacturerRow[]
  warehouse_activity?: OpeningBalancePreviewActivityRow[]
  blockers?: string[]
  review_items?: string[]
}

export interface OpeningBalanceBucket {
  orderCount: number
  totalQuantity: number
  references: string[]
}

export interface OpeningBalanceSummary {
  /** 1. Physical Opening Stock — the counted warehouse quantity only. */
  physicalOpeningStock: {
    totalQuantity: number
    countedRows: number
    missingRows: number
  }
  /** 2. Selected H2M Incoming After Cut-off — tracked separately, never posted now. */
  manufacturerIncomingAfterCutoff: OpeningBalanceBucket
  /** 3. D2H Carry Forward. */
  distributorCarryForward: OpeningBalanceBucket
  /** 4. D2H Cancel & Release. */
  distributorCancelRelease: OpeningBalanceBucket
  /** 5. D2H Excluded / Do Not Carry Forward (history-only distributor + H2M history-only). */
  excludedDoNotCarryForward: OpeningBalanceBucket
  /** 6. Stock in Transit — protected, not part of physical opening stock. */
  stockInTransit: OpeningBalanceBucket
  /** 7. Blocked or unresolved decisions. */
  blocked: {
    orderCount: number
    references: string[]
    messages: string[]
  }
}

const emptyBucket = (): OpeningBalanceBucket => ({ orderCount: 0, totalQuantity: 0, references: [] })

const pushRef = (bucket: OpeningBalanceBucket, reference: string | undefined, quantity: number) => {
  bucket.orderCount += 1
  bucket.totalQuantity += Number(quantity || 0)
  if (reference) bucket.references.push(reference)
}

/**
 * Derive the seven pre-posting summary buckets from the read-only preview.
 * Physical Opening Stock is the counted warehouse quantity ONLY — selected
 * H2M incoming is reported in its own bucket and never folded into the physical
 * baseline (it is added later through the proper warehouse receipt flow).
 */
export function summarizeOpeningBalance(preview: OpeningBalancePreview): OpeningBalanceSummary {
  const inventory = preview.inventory ?? []
  const distributor = preview.distributor_orders ?? []
  const manufacturer = preview.manufacturer_incoming ?? []
  const activity = preview.warehouse_activity ?? []

  const physicalOpeningStock = inventory.reduce(
    (acc, row) => {
      if (row.physical_quantity == null) {
        acc.missingRows += 1
      } else {
        acc.countedRows += 1
        acc.totalQuantity += Number(row.physical_quantity || 0)
      }
      return acc
    },
    { totalQuantity: 0, countedRows: 0, missingRows: 0 },
  )

  const manufacturerIncomingAfterCutoff = emptyBucket()
  const excludedDoNotCarryForward = emptyBucket()
  for (const row of manufacturer) {
    if (row.decision === 'carry_forward_incoming') {
      pushRef(manufacturerIncomingAfterCutoff, row.order_number, row.remaining_incoming_quantity ?? 0)
    } else if (row.decision === 'history_only') {
      pushRef(excludedDoNotCarryForward, row.order_number, 0)
    }
  }

  const distributorCarryForward = emptyBucket()
  const distributorCancelRelease = emptyBucket()
  const stockInTransit = emptyBucket()
  const blockedRefs: string[] = []
  for (const row of distributor) {
    const classification = row.classification
      ?? distributorClassification(row.status as DistributorOrderStatus, row.decision)
    if (classification === 'Carry Forward') {
      pushRef(distributorCarryForward, row.order_number, row.quantity ?? 0)
    } else if (classification === 'Cancel & Release') {
      pushRef(distributorCancelRelease, row.order_number, row.quantity ?? 0)
    } else if (classification === 'Stock in Transit') {
      pushRef(stockInTransit, row.order_number, row.quantity ?? 0)
    } else if (
      classification === 'Do Not Carry Forward'
      || classification === 'Historical Excluded'
      || classification === 'History Only'
    ) {
      // Explicit exclude, policy exclude, and closed/cancelled history sit in
      // the same "excluded" bucket: neither reserves, deducts nor releases stock.
      pushRef(excludedDoNotCarryForward, row.order_number, row.quantity ?? 0)
    } else if (classification === 'Blocked') {
      if (row.order_number) blockedRefs.push(row.order_number)
    }
  }

  for (const row of activity) {
    if (row.classification === 'Stock in Transit') {
      pushRef(stockInTransit, row.reference_no ?? undefined, 0)
    }
  }

  return {
    physicalOpeningStock,
    manufacturerIncomingAfterCutoff,
    distributorCarryForward,
    distributorCancelRelease,
    excludedDoNotCarryForward,
    stockInTransit,
    blocked: {
      orderCount: blockedRefs.length,
      references: blockedRefs,
      messages: [...(preview.blockers ?? [])],
    },
  }
}

// ---------------------------------------------------------------------------
// Posting guard & staleness
// ---------------------------------------------------------------------------

/**
 * A saved OTP-verifiable decision set is bound to an immutable snapshot hash.
 * When the live snapshot differs (an order status/quantity changed, a target
 * config became ineligible, a physical count changed) the saved decisions are
 * stale and posting must be blocked/refreshed. Mirrors the server snapshot-hash
 * check in verify_and_post_inventory_opening_cutoff.
 */
export function isOpeningBalanceDecisionStale(
  savedSnapshot: string | null | undefined,
  currentSnapshot: string | null | undefined,
): boolean {
  if (!savedSnapshot || !currentSnapshot) return true
  return savedSnapshot !== currentSnapshot
}

export interface OpeningBalancePostGuardInput {
  readiness?: 'Ready' | 'Review Required' | 'Blocked'
  isHqAdmin: boolean
  freezeActive: boolean
  /** A current or already-posted Opening Balance exists for this scope. */
  alreadyPosted: boolean
  /** Saved decisions no longer match the live server snapshot. */
  stale: boolean
}

export interface OpeningBalancePostGuard {
  canPost: boolean
  reasons: string[]
}

/**
 * Client-side gate deciding whether "Post Official Opening Balance" may run.
 * The server re-checks all of this atomically under locks — this only prevents
 * a request the server would certainly reject, and surfaces why.
 */
export function evaluateOpeningBalancePostGuard(input: OpeningBalancePostGuardInput): OpeningBalancePostGuard {
  const reasons: string[] = []
  if (!input.isHqAdmin) reasons.push('Only an HQ Admin may post the Opening Balance.')
  if (!input.freezeActive) reasons.push('The warehouse count freeze is not active.')
  if (input.readiness !== 'Ready') reasons.push('Server readiness is not "Ready"; resolve all blockers first.')
  if (input.alreadyPosted) reasons.push('An Opening Balance has already been posted for this scope.')
  if (input.stale) reasons.push('Saved decisions changed on the server; refresh and re-review before posting.')
  return { canPost: reasons.length === 0, reasons }
}
