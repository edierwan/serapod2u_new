// ===========================================================================
// Opening Balance — authoritative blocker recognition & guided resolution
// ---------------------------------------------------------------------------
// Review & Post (Step 5) and Transactions (Step 4) must consume ONE blocker
// collection. The reported contradiction was:
//   - Step 5 (report.blockers[]): 1 blocker (an allocation-ownership mismatch)
//   - Step 4 (transactions_historical_summary.blocked_count / warehouse_activity):
//                                  0 blockers / "All resolved"
// because the allocation-ownership blocker is emitted only in the top-level
// `report.blockers[]` string list — it is NOT a scoped transaction row, so it
// never reaches `blocked_count` or the Step 4 transaction list.
//
// This module turns the authoritative blocker set into STRUCTURED blocker
// details with a stable identity, a resolution step, an exact reason and the
// valid resolution actions. It consumes the server's structured
// `preview.blocker_details[]` when present (added by the forward-only migration
// 20260801160000_inventory_cutoff_blocker_details) and gracefully degrades to
// classifying the legacy `preview.blockers[]` string list otherwise — so the
// two steps agree with or without the migration applied.
//
// It NEVER mutates data, calls an RPC, changes an eligibility/quantity or
// enables a resolution the server has not validated. Resolution actions are
// presentation-only affordances; every mutation stays gated behind an explicit
// user action and server validation.
// ===========================================================================

import type { OpeningBalanceStepId } from './opening-balance-workspace'

export type OpeningBalanceBlockerCategory =
  | 'allocation_reconciliation'
  | 'transaction_resolution'
  | 'distributor_decision'
  | 'distributor_lifecycle'
  | 'carry_forward_overflow'
  | 'manufacturer_decision'
  | 'stock_count'
  | 'other'

export type OpeningBalanceResolutionKind =
  | 'carry_forward_related'
  | 'exclude_and_release'
  | 'select_related_order'
  | 'open_source_document'
  | 'mark_manual_investigation'
  | 'go_to_step'

/**
 * A recommended resolution action. `mutating` actions require an explicit user
 * action AND server validation before anything changes; `available` is false
 * unless the authoritative server state confirms the action is safe. Read-only
 * affordances (open source document, mark for manual investigation, navigate)
 * are never mutating and may always be offered.
 */
export interface OpeningBalanceResolutionAction {
  kind: OpeningBalanceResolutionKind
  label: string
  /** True when applying this action would change server state. */
  mutating: boolean
  /** Whether the action is offered as enabled given the known/validated state. */
  available: boolean
  /** Short guidance shown under a disabled action explaining the gate. */
  hint?: string
}

/**
 * Stable, non-textual identity for a blocker. Names are NOT unique, so
 * navigation and highlight rely on these identifiers when available.
 */
export interface OpeningBalanceBlockerIdentity {
  variantId?: string
  variantName?: string
  stockConfigId?: string
  configLabel?: string
  warehouseOrganizationId?: string
  productCategoryId?: string
  cutoffId?: string
  sourceOrderId?: string
  sourceOrderNumber?: string
  sourceDocumentRef?: string
  allocationStatus?: string
  allocatedQuantity?: number
  selectedQuantity?: number
  difference?: number
  beforeCutoff?: boolean
}

export interface OpeningBalanceBlockerDetail {
  /** Stable id used for navigation + highlight; server id, else derived. */
  id: string
  /** Server code when present, else a derived `category`-based code. */
  code: string
  category: OpeningBalanceBlockerCategory
  /** Wizard step where the blocker is resolved. */
  step: OpeningBalanceStepId
  /** Exact, human-readable reason — identical between Step 4 and Step 5. */
  reason: string
  /** Contextual action label, e.g. "Review Potato Allocation". */
  actionLabel: string
  identity: OpeningBalanceBlockerIdentity
  resolutionActions: OpeningBalanceResolutionAction[]
  /**
   * True when the blocker is an inventory allocation that owns no selected /
   * carried-forward transaction row — an "orphan" that must be shown even
   * though it has no corresponding Step 4 transaction line.
   */
  orphan: boolean
}

// ---------------------------------------------------------------------------
// Deterministic identity helpers
// ---------------------------------------------------------------------------

const slug = (value: string | undefined): string =>
  (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

/** Small deterministic hash (djb2) so a text-only blocker still has a stable id. */
function stableHash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0xffffffff
  }
  return (hash >>> 0).toString(36)
}

/**
 * The short, human name used in a contextual action label. Prefers the variant
 * suffix in brackets ("Zero Edition Novella [ Potato ]" → "Potato"), else the
 * whole variant name, else a generic fallback.
 */
export function blockerShortName(variantName?: string): string {
  const name = (variantName ?? '').trim()
  const bracket = name.match(/\[\s*([^\]]+?)\s*\]\s*$/)
  if (bracket?.[1]) return bracket[1].trim()
  return name || 'Item'
}

// ---------------------------------------------------------------------------
// String-blocker classification (legacy / pre-migration fallback)
// ---------------------------------------------------------------------------

const ALLOCATION_RE =
  /^Allocation ownership does not reconcile for (.+) \(([^()]*(?:\([^()]*\))?[^()]*)\): inventory allocated (\d+), selected order quantity (\d+)\.$/

interface Classification {
  category: OpeningBalanceBlockerCategory
  step: OpeningBalanceStepId
  actionLabel: string
  identity: OpeningBalanceBlockerIdentity
  orphan: boolean
}

/**
 * Classify a single legacy blocker message into a category, resolution step,
 * contextual action label and any identity that can be parsed from the text.
 * Text parsing is a best-effort fallback: it never invents identifiers it
 * cannot read, and the structured `blocker_details[]` contract supersedes it.
 */
export function classifyBlockerMessage(message: string): Classification {
  const text = message.trim()

  const allocation = text.match(ALLOCATION_RE)
  if (allocation) {
    const variantName = allocation[1].trim()
    const configLabel = allocation[2].trim()
    const allocatedQuantity = Number(allocation[3])
    const selectedQuantity = Number(allocation[4])
    return {
      category: 'allocation_reconciliation',
      step: 'transactions',
      actionLabel: `Review ${blockerShortName(variantName)} Allocation`,
      identity: {
        variantName,
        configLabel,
        allocatedQuantity,
        selectedQuantity,
        difference: allocatedQuantity - selectedQuantity,
      },
      orphan: selectedQuantity === 0,
    }
  }

  if (/requires individual resolution/i.test(text)) {
    return {
      category: 'transaction_resolution',
      step: 'transactions',
      actionLabel: 'Resolve Transaction Blocker',
      identity: {},
      orphan: false,
    }
  }

  if (/^Distributor order .* requires a carry-forward or cancel-and-release/i.test(text)
    || /^Distributor order .* (has mixed carry-forward|is .*Approval already posted)/i.test(text)) {
    return {
      category: /mixed carry-forward/i.test(text) ? 'distributor_lifecycle' : 'distributor_decision',
      step: 'd2h',
      actionLabel: 'Go to D2H Policy',
      identity: {},
      orphan: false,
    }
  }

  if (/^Carried allocation exceeds physical opening quantity/i.test(text)) {
    return {
      category: 'carry_forward_overflow',
      step: 'd2h',
      actionLabel: 'Go to D2H Policy',
      identity: {},
      orphan: false,
    }
  }

  if (/^Manufacturer order/i.test(text)) {
    return {
      category: 'manufacturer_decision',
      step: 'h2m',
      actionLabel: 'Go to H2M Incoming',
      identity: {},
      orphan: false,
    }
  }

  if (/^Physical count is missing/i.test(text)) {
    return {
      category: 'stock_count',
      step: 'freeze',
      actionLabel: 'Review Stock Count',
      identity: {},
      orphan: false,
    }
  }

  return {
    category: 'other',
    step: 'review',
    actionLabel: 'Review Item',
    identity: {},
    orphan: false,
  }
}

/**
 * Resolution actions for a blocker, gated by what is actually known/validated.
 * Mutating actions (carry forward, exclude & release, select order) are only
 * ever offered as enabled when the authoritative server state has confirmed
 * them (server-supplied via structured details). Read-only actions (open source
 * document, mark for manual investigation) are always safe to offer.
 */
export function resolutionActionsFor(
  category: OpeningBalanceBlockerCategory,
  identity: OpeningBalanceBlockerIdentity,
  serverActions?: OpeningBalanceResolutionAction[],
): OpeningBalanceResolutionAction[] {
  if (serverActions && serverActions.length > 0) return serverActions

  if (category !== 'allocation_reconciliation') return []

  const hasSource = Boolean(identity.sourceOrderId || identity.sourceDocumentRef || identity.sourceOrderNumber)
  const allocated = identity.allocatedQuantity ?? 0
  const selected = identity.selectedQuantity ?? 0
  const difference = identity.difference ?? (allocated - selected)
  // An "orphan" residual: inventory holds an allocation that no selected/carried
  // transaction owns (selected 0, difference > 0). exclude_and_release is the
  // valid audited cleanup for it. select/carry-forward need a genuine submitted
  // related order, which an orphan does not have — so they stay unavailable.
  const isOrphan = selected === 0 && difference > 0
  // The resolver RPC needs the exact variant + configuration identity. The
  // structured server contract carries them; the legacy string fallback does
  // not, so exclude stays disabled there with a refresh hint (never a dead click).
  const resolvable = Boolean(identity.variantId && identity.stockConfigId)
  const gate = 'Requires the Opening Balance allocation resolver and an explicit confirmation.'
  const noOwnerHint = 'No active submitted order owns this residual allocation, so it cannot be linked or carried forward.'
  const refreshHint = 'Refresh the Opening Balance report to load the allocation details, then release.'

  return [
    {
      kind: 'select_related_order',
      label: 'Select Correct Related Order',
      mutating: true,
      available: false,
      hint: isOrphan ? noOwnerHint : gate,
    },
    {
      kind: 'carry_forward_related',
      label: 'Carry Forward Related Transaction',
      mutating: true,
      available: false,
      hint: isOrphan ? noOwnerHint : gate,
    },
    {
      // Enabled for an orphan residual with explicit confirmation. The
      // SECURITY DEFINER RPC still refuses (inventory_cutoff_allocation_active_owner)
      // if a genuine submitted order owns it, so enabling the button never
      // weakens the backend guard — the refusal is surfaced to the user.
      kind: 'exclude_and_release',
      label: 'Exclude Transaction & Release Allocation',
      mutating: true,
      available: isOrphan && resolvable,
      hint: !isOrphan ? gate : !resolvable ? refreshHint : undefined,
    },
    {
      kind: 'open_source_document',
      label: 'Open Source Document',
      mutating: false,
      available: hasSource,
      hint: hasSource ? undefined : 'No related order/document is linked to this allocation.',
    },
    {
      kind: 'mark_manual_investigation',
      label: 'Mark for Manual Investigation',
      mutating: false,
      available: true,
    },
  ]
}

// ---------------------------------------------------------------------------
// Structured contract coercion (post-migration)
// ---------------------------------------------------------------------------

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

const asNumber = (value: unknown): number | undefined => {
  if (value == null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function coerceIdentity(raw: Record<string, unknown>): OpeningBalanceBlockerIdentity {
  return {
    variantId: asString(raw.product_variant_id ?? raw.variant_id),
    variantName: asString(raw.variant_name),
    stockConfigId: asString(raw.stock_config_id),
    configLabel: asString(raw.config_label),
    warehouseOrganizationId: asString(raw.warehouse_organization_id),
    productCategoryId: asString(raw.product_category_id),
    cutoffId: asString(raw.cutoff_id),
    sourceOrderId: asString(raw.source_order_id),
    sourceOrderNumber: asString(raw.source_order_number),
    sourceDocumentRef: asString(raw.source_document_ref ?? raw.reference),
    allocationStatus: asString(raw.allocation_status),
    allocatedQuantity: asNumber(raw.allocated_quantity),
    selectedQuantity: asNumber(raw.selected_quantity),
    difference: asNumber(raw.difference),
    beforeCutoff: typeof raw.before_cutoff === 'boolean' ? raw.before_cutoff : undefined,
  }
}

const STEP_IDS: OpeningBalanceStepId[] = ['freeze', 'd2h', 'h2m', 'transactions', 'review']
const CATEGORIES: OpeningBalanceBlockerCategory[] = [
  'allocation_reconciliation', 'transaction_resolution', 'distributor_decision',
  'distributor_lifecycle', 'carry_forward_overflow', 'manufacturer_decision',
  'stock_count', 'other',
]

function coerceServerActions(value: unknown): OpeningBalanceResolutionAction[] | undefined {
  if (!Array.isArray(value)) return undefined
  const actions: OpeningBalanceResolutionAction[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const kind = row.kind
    if (typeof kind !== 'string') continue
    actions.push({
      kind: kind as OpeningBalanceResolutionKind,
      label: asString(row.label) ?? kind,
      mutating: Boolean(row.mutating),
      available: Boolean(row.available),
      hint: asString(row.hint),
    })
  }
  return actions.length > 0 ? actions : undefined
}

function coerceStructuredDetail(raw: Record<string, unknown>, index: number): OpeningBalanceBlockerDetail {
  const reason = asString(raw.reason) ?? ''
  const category = (CATEGORIES.includes(raw.category as OpeningBalanceBlockerCategory)
    ? raw.category
    : classifyBlockerMessage(reason).category) as OpeningBalanceBlockerCategory
  const fallback = classifyBlockerMessage(reason)
  const step = (STEP_IDS.includes(raw.step as OpeningBalanceStepId)
    ? raw.step
    : fallback.step) as OpeningBalanceStepId
  const identity = coerceIdentity(raw)
  // Merge parsed identity for any field the server omitted.
  const mergedIdentity: OpeningBalanceBlockerIdentity = { ...fallback.identity, ...identity }
  const derivedId = [category, mergedIdentity.variantId, mergedIdentity.stockConfigId].filter(Boolean).join(':')
    || `${category}:${stableHash(reason || String(index))}`
  const id = asString(raw.id) ?? derivedId
  return {
    id,
    code: asString(raw.code) ?? category,
    category,
    step,
    reason,
    actionLabel: asString(raw.action_label) ?? fallback.actionLabel,
    identity: mergedIdentity,
    resolutionActions: resolutionActionsFor(category, mergedIdentity, coerceServerActions(raw.resolution_actions)),
    orphan: typeof raw.orphan === 'boolean' ? raw.orphan : fallback.orphan,
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface BlockerParseInput {
  /** Structured contract (post-migration). Wins when present. */
  blocker_details?: unknown
  /** Legacy string blockers (pre-migration fallback). */
  blockers?: string[]
}

/**
 * Parse the authoritative blocker set into structured details. Prefers the
 * server's structured `blocker_details[]`; otherwise classifies the legacy
 * `blockers[]` strings so Step 4 and Step 5 still consume the same collection.
 */
export function parseOpeningBalanceBlockers(input: BlockerParseInput): OpeningBalanceBlockerDetail[] {
  if (Array.isArray(input.blocker_details) && input.blocker_details.length > 0) {
    return input.blocker_details
      .filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === 'object')
      .map((raw, index) => coerceStructuredDetail(raw, index))
  }

  const messages = (input.blockers ?? []).map(m => String(m ?? '').trim()).filter(Boolean)
  return messages.map((reason, index) => {
    const c = classifyBlockerMessage(reason)
    const id = [c.category, c.identity.variantId, c.identity.stockConfigId].filter(Boolean).join(':')
      || `${c.category}:${slug(c.identity.variantName)}:${slug(c.identity.configLabel)}:${stableHash(reason)}`
    return {
      id,
      code: c.category,
      category: c.category,
      step: c.step,
      reason,
      actionLabel: c.actionLabel,
      identity: c.identity,
      resolutionActions: resolutionActionsFor(c.category, c.identity),
      orphan: c.orphan,
    }
  })
}

/** The blocker details whose resolution home is the Transactions step (Step 4). */
export function transactionStepBlockers(
  details: OpeningBalanceBlockerDetail[],
): OpeningBalanceBlockerDetail[] {
  return details.filter(d => d.step === 'transactions')
}

/**
 * Blocker details that must render as their OWN card in Step 4 because they are
 * allocation/orphan reconciliation blockers with no corresponding typed
 * transaction row (Stock Adjustment / Return / Stock Transfer). These are the
 * ones the previous contract hid entirely.
 */
export function orphanAllocationBlockers(
  details: OpeningBalanceBlockerDetail[],
): OpeningBalanceBlockerDetail[] {
  return details.filter(d => d.step === 'transactions' && d.category === 'allocation_reconciliation')
}
