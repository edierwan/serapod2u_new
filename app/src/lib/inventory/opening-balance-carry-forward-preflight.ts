// ============================================================================
// Opening Balance — D2H Carry Forward preflight (pure, UI-agnostic).
// ----------------------------------------------------------------------------
// Proactively surfaces the SAME target-configuration prerequisite and precise
// reason codes enforced by `set_inventory_cutoff_decision` and atomic posting,
// so a user never has to click "Apply to Order" to discover an eligibility
// problem.
//
// This module NEVER mutates data, calls an RPC, or implements configuration
// eligibility. The database function
// `resolve_inventory_cutoff_d2h_carry_forward` is the single resolver used by
// preflight, decision application, and atomic posting. This module only shapes
// its result for presentation and translates reason codes into guidance.
// ============================================================================

import type { DistributorLine, DistributorOrderGroup } from './opening-balance-workspace'

// ---------------------------------------------------------------------------
// Eligibility snapshot (produced by the read-only preflight route)
// ---------------------------------------------------------------------------

/** Per-order-item Carry Forward readiness returned by the database resolver. */
export interface CarryForwardLineEligibility {
  orderItemId: string
  variantId: string
  carryForwardAvailable: boolean
  configId: string | null
  reasonCode: string
  variantName?: string | null
  alternativeName?: string | null
  variantCode?: string | null
  productCode?: string | null
  orderWarehouseOrganizationId?: string | null
  cutoffWarehouseOrganizationId?: string | null
  sessionWarehouseOrganizationId?: string | null
  configVariantId?: string | null
  configStatus?: string | null
  allowSo?: boolean | null
  defaultForOrd?: boolean | null
  packaging?: string | null
  volumeMl?: number | null
  inSessionScope?: boolean
}

/** Keyed by `order_item_id`. A missing key means "not yet checked" (unknown). */
export type CarryForwardEligibilityMap = Record<string, CarryForwardLineEligibility>

export const CARRY_FORWARD_CONFIG_REQUIREMENT = '20 mg New Box stock configuration'

/**
 * The single order-level explanation shown when an order cannot Carry Forward
 * because a target configuration is missing. Kept identical to the wording the
 * task specifies so the message is stable and testable.
 */
export const CARRY_FORWARD_BLOCKED_EXPLANATION =
  'Carry Forward is unavailable because one or more items do not have a valid 20 mg New Box stock configuration for this warehouse.'

export interface CarryForwardAffectedItem {
  orderItemId: string
  variantId: string
  variant: string
  variantCode: string | null
  productCode: string | null
  quantity: number
  warehouse: string
  /** What the server requires but cannot find. */
  requirement: string
  reasonCode: string
  reason: string
  /** A human-readable next step the operator can act on. */
  correctiveAction: string
}

export interface D2hCarryForwardStatus {
  /**
   * True when this order still needs a decision AND at least one of its
   * submitted lines has no valid Carry Forward target configuration. An order
   * already resolved with an explicit decision (e.g. Do Not Carry Forward) is
   * NOT blocked — another allowed business decision resolves it.
   */
  blocked: boolean
  /** True when a preflight result exists for every submitted line's variant. */
  checked: boolean
  affected: CarryForwardAffectedItem[]
  blockedLabel: string
}

const SUBMITTED = 'submitted'

const REASON_GUIDANCE: Record<string, {
  reason: (variant: string, warehouse: string) => string
  action: string
}> = {
  inventory_cutoff_configuration_missing: {
    reason: (variant, warehouse) =>
      `${variant} has no 20 mg New Box configuration for ${warehouse}.`,
    action: 'Create the required stock configuration, then refresh this check.',
  },
  inventory_cutoff_configuration_inactive: {
    reason: (variant, warehouse) =>
      `${variant} has a 20 mg New Box configuration, but it is inactive for ${warehouse}.`,
    action: 'Activate the existing configuration, then refresh this check.',
  },
  inventory_cutoff_configuration_wrong_warehouse: {
    reason: (variant) =>
      `${variant} belongs to an order fulfilled from a different warehouse than this Opening Balance.`,
    action: 'Review the order fulfillment warehouse; do not create a duplicate configuration.',
  },
  inventory_cutoff_session_wrong_warehouse: {
    reason: (_variant, warehouse) =>
      `The Opening Balance session and cutoff do not reference the same warehouse (${warehouse}).`,
    action: 'Reload the correct Opening Balance session and recheck.',
  },
  inventory_cutoff_configuration_wrong_variant: {
    reason: (variant) =>
      `The available 20 mg New Box configuration references a different product variant than ${variant}.`,
    action: 'Correct the variant association; do not select a configuration by display name.',
  },
  inventory_cutoff_configuration_not_order_eligible: {
    reason: (variant, warehouse) =>
      `${variant} has an active 20 mg New Box configuration, but it is not order-eligible for ${warehouse}.`,
    action: 'Enable distributor-order eligibility on the existing configuration, then refresh this check.',
  },
  inventory_cutoff_configuration_not_in_session_scope: {
    reason: (variant) =>
      `${variant} has an eligible 20 mg New Box configuration, but it is not part of this Opening Balance session’s immutable scope.`,
    action: 'Use the configuration captured by the correct Opening Balance draft; do not create a duplicate.',
  },
  inventory_cutoff_configuration_ambiguous: {
    reason: (variant) =>
      `${variant} has more than one 20 mg New Box configuration, so no target can be selected safely.`,
    action: 'Resolve the duplicate configuration records, then refresh this check.',
  },
  inventory_cutoff_stale_preflight_data: {
    reason: () => 'The saved Carry Forward target no longer matches the current authoritative resolver.',
    action: 'Refresh and choose Carry Forward again.',
  },
}

const guidanceFor = (reasonCode: string, variant: string, warehouse: string) => {
  const guidance = REASON_GUIDANCE[reasonCode]
  if (guidance) {
    return { reason: guidance.reason(variant, warehouse), correctiveAction: guidance.action }
  }
  return {
    reason: `Carry Forward eligibility could not be confirmed for ${variant} at ${warehouse}.`,
    correctiveAction: 'Refresh this check. If the issue remains, contact support with the order number.',
  }
}

const BLOCKED_LABELS: Record<string, string> = {
  inventory_cutoff_configuration_missing: 'Blocked — Configuration Missing',
  inventory_cutoff_configuration_inactive: 'Blocked — Configuration Inactive',
  inventory_cutoff_configuration_wrong_warehouse: 'Blocked — Wrong Warehouse',
  inventory_cutoff_session_wrong_warehouse: 'Blocked — Wrong Warehouse',
  inventory_cutoff_configuration_wrong_variant: 'Blocked — Variant Mismatch',
  inventory_cutoff_configuration_not_order_eligible: 'Blocked — Not Order-eligible',
  inventory_cutoff_configuration_not_in_session_scope: 'Blocked — Outside Session Scope',
  inventory_cutoff_configuration_ambiguous: 'Blocked — Configuration Ambiguous',
  inventory_cutoff_stale_preflight_data: 'Blocked — Recheck Required',
}

/**
 * Derive the Carry Forward configuration status for one grouped D2H order from
 * the read-only eligibility snapshot. Only `submitted` lines (the sole status
 * the server accepts a decision for) are considered. Purely derived — no
 * mutation, no network, no re-computation of the eligibility itself.
 */
export function d2hCarryForwardStatus(
  group: Pick<DistributorOrderGroup, 'lines' | 'decisionsRemaining' | 'warehouse'>,
  eligibility: CarryForwardEligibilityMap,
): D2hCarryForwardStatus {
  const submitted = group.lines.filter(line => line.status === SUBMITTED)
  const checkable = submitted.filter(
    (l): l is DistributorLine & { order_item_id: string; variant_id: string } =>
      Boolean(l.order_item_id && l.variant_id),
  )
  // "checked" only when every submitted order item has a database result.
  const checked =
    checkable.length > 0 && checkable.every(line => eligibility[line.order_item_id] !== undefined)

  const affected: CarryForwardAffectedItem[] = []
  for (const line of checkable) {
    const result = eligibility[line.order_item_id]
    if (result && result.carryForwardAvailable === false) {
      const variant = (line.variant || result.variantName || 'this item').trim()
      const warehouse = (line.warehouse || group.warehouse || 'this warehouse').trim()
      const guidance = guidanceFor(result.reasonCode, variant, warehouse)
      affected.push({
        orderItemId: line.order_item_id,
        variantId: line.variant_id,
        variant,
        variantCode: result.variantCode ?? null,
        productCode: result.productCode ?? null,
        quantity: Number(line.quantity || 0),
        warehouse,
        requirement: CARRY_FORWARD_CONFIG_REQUIREMENT,
        reasonCode: result.reasonCode,
        reason: guidance.reason,
        correctiveAction: guidance.correctiveAction,
      })
    }
  }

  // An order already resolved with an explicit decision is no longer blocked.
  const blocked = affected.length > 0 && group.decisionsRemaining > 0
  const firstReason = affected[0]?.reasonCode
  return {
    blocked,
    checked,
    affected,
    blockedLabel: firstReason
      ? BLOCKED_LABELS[firstReason] ?? 'Blocked — Carry Forward Unavailable'
      : 'Blocked — Carry Forward Unavailable',
  }
}

/** Order-item ids that cannot Carry Forward, for disabling the option per line. */
export function carryForwardBlockedOrderItemIds(eligibility: CarryForwardEligibilityMap): Set<string> {
  const blocked = new Set<string>()
  for (const [orderItemId, result] of Object.entries(eligibility)) {
    if (result.carryForwardAvailable === false) blocked.add(orderItemId)
  }
  return blocked
}

// ---------------------------------------------------------------------------
// Continue-to-H2M gate
// ---------------------------------------------------------------------------

export interface D2hContinueGate {
  canContinue: boolean
  /** Actionable D2H orders still lacking an explicit decision. */
  unresolvedCount: number
  /** Exact, human-readable reason, or null when the user may continue. */
  message: string | null
  /** Grouping key of the first unresolved order, for a "View Unresolved Order" jump. */
  firstUnresolvedKey: string | null
}

/**
 * Gate for advancing from D2H → H2M. Blocks while any actionable order still
 * has no explicit decision. A configuration-blocked Carry Forward order counts
 * as resolved once the user records another allowed decision (Do Not Carry
 * Forward / Cancel & Release), so the gate keys off "decisions remaining", not
 * Carry Forward availability.
 */
export function d2hContinueGate(
  actionableGroups: DistributorOrderGroup[],
  options?: {
    policyResolved?: boolean
    policyRequired?: boolean
    /** Authoritative saved policy. Option A never requires per-order decisions. */
    policy?: 'exclude_all' | 'review_select' | null
  },
): D2hContinueGate {
  const policyRequired = Boolean(options?.policyRequired)
  const policyResolved = Boolean(options?.policyResolved)
  const policy = options?.policy ?? null

  if (policyRequired && !policyResolved) {
    return {
      canContinue: false,
      unresolvedCount: 1,
      message: 'Save a D2H policy (Start Fresh or Review Orders) before continuing.',
      firstUnresolvedKey: actionableGroups[0]?.key ?? null,
    }
  }

  // Option A: the saved policy alone resolves Step 2 — never count hidden SOs.
  if (policyResolved && policy === 'exclude_all') {
    return { canContinue: true, unresolvedCount: 0, message: null, firstUnresolvedKey: null }
  }

  // Option B: remaining undecided submitted lines still block Continue.
  if (policyResolved) {
    const unresolvedUnderReview = actionableGroups.filter(group => group.decisionsRemaining > 0)
    if (unresolvedUnderReview.length === 0) {
      return { canContinue: true, unresolvedCount: 0, message: null, firstUnresolvedKey: null }
    }
    return {
      canContinue: false,
      unresolvedCount: unresolvedUnderReview.length,
      message: `Resolve ${unresolvedUnderReview.length} D2H order${unresolvedUnderReview.length === 1 ? '' : 's'} before continuing.`,
      firstUnresolvedKey: unresolvedUnderReview[0]?.key ?? null,
    }
  }

  const unresolved = actionableGroups.filter(group => group.decisionsRemaining > 0)
  const unresolvedCount = unresolved.length
  if (unresolvedCount === 0) {
    return { canContinue: true, unresolvedCount: 0, message: null, firstUnresolvedKey: null }
  }
  return {
    canContinue: false,
    unresolvedCount,
    message: `Resolve ${unresolvedCount} D2H order${unresolvedCount === 1 ? '' : 's'} before continuing.`,
    firstUnresolvedKey: unresolved[0]?.key ?? null,
  }
}

// ---------------------------------------------------------------------------
// Error-code → human-readable mapping (Opening Balance cut-off decisions)
// ---------------------------------------------------------------------------

export interface OpeningBalanceErrorContext {
  orderNumber?: string
  variant?: string
  warehouse?: string
}

export interface MappedOpeningBalanceError {
  /** The raw server code (retained for developer diagnostics, never the primary UI text). */
  code: string
  title: string
  message: string
}

const KNOWN_ERROR_CODE = /(inventory_cutoff_[a-z0-9_]+|organization_mismatch|permission_denied)/i

/**
 * Extract a known Opening Balance error code from an arbitrary thrown value.
 * The server raises bare codes (e.g. `raise exception '...'`) that surface in
 * `error.message`; we match defensively so wrapping/prefixes don't hide them.
 */
export function extractOpeningBalanceErrorCode(error: unknown): string | null {
  const text =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '')
  const match = text.match(KNOWN_ERROR_CODE)
  return match ? match[1].toLowerCase() : null
}

const withContext = (base: string, ctx?: OpeningBalanceErrorContext) => {
  const bits: string[] = []
  if (ctx?.orderNumber) bits.push(`Order ${ctx.orderNumber}`)
  if (ctx?.variant) bits.push(`item “${ctx.variant}”`)
  if (ctx?.warehouse) bits.push(`at ${ctx.warehouse}`)
  return bits.length ? `${base} (${bits.join(' · ')})` : base
}

/**
 * Maintainable mapping of Opening Balance decision error codes to guidance.
 * Every message says what is wrong and what to do next; the raw code is kept in
 * `.code` for diagnostics but is never the only thing a user sees. Unknown
 * codes fall back to a safe, actionable message.
 */
export function mapOpeningBalanceError(
  error: unknown,
  ctx?: OpeningBalanceErrorContext,
): MappedOpeningBalanceError {
  const code = extractOpeningBalanceErrorCode(error) ?? 'unknown'
  switch (code) {
    case 'inventory_cutoff_20ml_new_box_missing':
    case 'inventory_cutoff_configuration_missing': {
      const who = ctx?.variant ? `“${ctx.variant}”` : 'one or more items'
      const where = ctx?.warehouse ? ` at ${ctx.warehouse}` : ''
      return {
        code,
        title: 'Carry Forward unavailable',
        message:
          `${CARRY_FORWARD_CONFIG_REQUIREMENT} is missing for ${who}${where}. ` +
          'Create the required stock configuration, then refresh this check' +
          `${ctx?.orderNumber ? ` before re-deciding order ${ctx.orderNumber}` : ''}.`,
      }
    }
    case 'inventory_cutoff_configuration_inactive':
      return {
        code,
        title: 'Configuration inactive',
        message: withContext(
          'The 20 mg New Box configuration exists, but it is inactive. Activate the existing configuration, then refresh and recheck',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_configuration_wrong_warehouse':
    case 'inventory_cutoff_session_wrong_warehouse':
      return {
        code,
        title: 'Wrong warehouse',
        message: withContext(
          'The order, Opening Balance session, and cutoff do not resolve to the same warehouse. Review the warehouse assignment; do not create a duplicate configuration',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_configuration_wrong_variant':
      return {
        code,
        title: 'Variant mismatch',
        message: withContext(
          'The available 20 mg New Box configuration references a different product variant. Correct the stable-ID association; do not match by display name',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_configuration_not_order_eligible':
      return {
        code,
        title: 'Configuration not order-eligible',
        message: withContext(
          'The active 20 mg New Box configuration is not enabled for distributor orders. Enable order eligibility on the existing configuration, then refresh and recheck',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_configuration_not_receiving_eligible':
      return {
        code,
        title: 'Configuration not receiving-eligible',
        message: withContext(
          'The active configuration is not enabled for H2M order receiving. Enable order receiving on the correct existing configuration, then refresh and recheck',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_configuration_not_in_session_scope':
      return {
        code,
        title: 'Configuration outside Opening Balance scope',
        message: withContext(
          'The eligible 20 mg New Box configuration is not part of this Opening Balance session’s immutable scope. Use the correct draft; do not create a duplicate configuration',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_configuration_ambiguous':
      return {
        code,
        title: 'Configuration is ambiguous',
        message: withContext(
          'More than one 20 mg New Box configuration was found, so the server will not choose silently. Resolve the duplicate records, then refresh and recheck',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_stale_preflight_data':
      return {
        code,
        title: 'Carry Forward check changed',
        message: withContext(
          'The saved Carry Forward target no longer matches current authoritative data. Refresh and choose the decision again',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_allocation_not_active':
      return {
        code,
        title: 'Allocation no longer active',
        message: withContext(
          'The live allocation for this order changed, so this decision can no longer be applied. Refresh & recheck, then choose a decision again',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_distributor_not_eligible':
      return {
        code,
        title: 'Order no longer eligible',
        message: withContext(
          'This distributor order can no longer accept that decision (its status changed). Refresh & recheck',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_manufacturer_not_eligible':
      return {
        code,
        title: 'H2M order no longer eligible',
        message: withContext(
          'This H2M item no longer has an approved or closed outstanding incoming quantity. Refresh & recheck',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_no_outstanding_incoming':
      return {
        code,
        title: 'No outstanding incoming quantity',
        message: withContext(
          'This H2M item is already fully received and no longer needs an incoming decision. Refresh & recheck',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_manufacturer_variant_lines_conflicting':
      return {
        code,
        title: 'H2M variant lines conflict',
        message: withContext(
          'This H2M order contains duplicate lines for the same exact variant, so configuration and outstanding quantity cannot be resolved safely',
          ctx,
        ) + '.',
      }
    case 'inventory_cutoff_not_active':
      return {
        code,
        title: 'Count no longer active',
        message: 'The Opening Balance count freeze is no longer active. Reload the Opening Balance draft.',
      }
    case 'organization_mismatch':
      return {
        code,
        title: 'Wrong warehouse',
        message: withContext(
          'This order is fulfilled from a different warehouse than the one being counted',
          ctx,
        ) + '.',
      }
    case 'permission_denied':
      return {
        code,
        title: 'Not permitted',
        message: 'Only an HQ administrator may record Opening Balance decisions.',
      }
    default:
      return {
        code,
        title: 'Could not apply decision',
        message: withContext(
          'The server rejected this action. Refresh & recheck and try again; if it persists, contact support',
          ctx,
        ) + '.',
      }
  }
}
