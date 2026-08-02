import type {
  ManufacturerDecision,
} from './opening-balance-classification'
import type {
  ManufacturerLine,
  ManufacturerOrderGroup,
} from './opening-balance-workspace'

export interface H2mIncomingLineEligibility {
  orderItemId: string
  variantId: string
  incomingAvailable: boolean
  configId: string | null
  selectedConfigId?: string | null
  configLabel?: string | null
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
  allowOrd?: boolean | null
  inSessionScope?: boolean
}

export type H2mIncomingEligibilityMap = Record<string, H2mIncomingLineEligibility>

export interface H2mAffectedItem {
  orderItemId: string
  variantId: string
  variant: string
  variantCode?: string | null
  productCode?: string | null
  quantity: number
  warehouse: string
  reasonCode: string
  reason: string
  correctiveAction: string
}

export interface H2mOrderEligibility {
  checked: boolean
  eligibleCount: number
  blockedCount: number
  alreadyResolvedCount: number
  unresolvedCount: number
  incomingTargetIds: string[]
  historyTargetIds: string[]
  affected: H2mAffectedItem[]
}

export interface H2mDecisionState {
  appliedDecision: ManufacturerDecision | null
  mixed: boolean
  partial: boolean
}

const actionableManufacturerLines = (group: ManufacturerOrderGroup): ManufacturerLine[] =>
  group.lines.filter(line =>
    Boolean(line.order_item_id) &&
    ['approved', 'closed'].includes(line.status ?? '') &&
    Number(line.remaining_incoming_quantity || 0) > 0,
  )

const reasonGuidance = (
  reasonCode: string,
  variant: string,
  warehouse: string,
): { reason: string; correctiveAction: string } => {
  switch (reasonCode) {
    case 'inventory_cutoff_configuration_missing':
      return {
        reason: `${variant} has no stock configuration available for H2M receiving at ${warehouse}.`,
        correctiveAction: 'Create the required receiving configuration, then Refresh & Recheck.',
      }
    case 'inventory_cutoff_configuration_inactive':
      return {
        reason: `${variant} has configurations, but none are active at ${warehouse}.`,
        correctiveAction: 'Activate the correct existing configuration, then Refresh & Recheck.',
      }
    case 'inventory_cutoff_configuration_wrong_warehouse':
    case 'inventory_cutoff_session_wrong_warehouse':
      return {
        reason: `${variant} belongs to an H2M order or Opening Balance session for a different warehouse.`,
        correctiveAction: 'Review the order destination and Opening Balance warehouse; do not create a duplicate configuration.',
      }
    case 'inventory_cutoff_configuration_wrong_variant':
      return {
        reason: `${variant} has a selected configuration belonging to a different variant.`,
        correctiveAction: 'Correct the exact variant association; do not match configurations by display name.',
      }
    case 'inventory_cutoff_configuration_not_receiving_eligible':
      return {
        reason: `${variant} has no active configuration enabled for H2M order receiving at ${warehouse}.`,
        correctiveAction: 'Enable order receiving on the correct existing configuration, then Refresh & Recheck.',
      }
    case 'inventory_cutoff_configuration_not_in_session_scope':
      return {
        reason: `${variant} has a receiving configuration, but it is outside this Opening Balance session’s immutable scope.`,
        correctiveAction: 'Use the correct Opening Balance draft; do not create a duplicate configuration.',
      }
    case 'inventory_cutoff_configuration_ambiguous':
      return {
        reason: `${variant} has multiple eligible scoped receiving configurations, so none can be selected safely.`,
        correctiveAction: 'Resolve the duplicate eligible configuration records, then Refresh & Recheck.',
      }
    case 'inventory_cutoff_stale_preflight_data':
      return {
        reason: `${variant} must be checked again because its saved configuration no longer matches current data.`,
        correctiveAction: 'Refresh & Recheck before applying another decision.',
      }
    default:
      return {
        reason: `Current H2M receiving eligibility could not be confirmed for ${variant} at ${warehouse}.`,
        correctiveAction: 'Refresh & Recheck. If the issue remains, contact support with the order number.',
      }
  }
}

export function h2mOrderEligibility(
  group: ManufacturerOrderGroup,
  eligibility: H2mIncomingEligibilityMap,
  warehouse: string,
): H2mOrderEligibility {
  const actionable = actionableManufacturerLines(group)
  const checked = actionable.length > 0 && actionable.every(line =>
    Boolean(line.order_item_id && eligibility[line.order_item_id]),
  )
  const unresolved = actionable.filter(line => !line.decision)
  const invalidSavedIncoming = actionable.filter(line =>
    line.decision === 'carry_forward_incoming' &&
    line.order_item_id &&
    eligibility[line.order_item_id]?.incomingAvailable !== true,
  )
  const incomingTargetIds: string[] = []
  const historyTargetIds: string[] = []
  const affected: H2mAffectedItem[] = []

  for (const line of [...unresolved, ...invalidSavedIncoming]) {
    const orderItemId = line.order_item_id as string
    const result = eligibility[orderItemId]
    if (!line.decision) historyTargetIds.push(orderItemId)
    if (result?.incomingAvailable) {
      if (!line.decision) incomingTargetIds.push(orderItemId)
      continue
    }
    const reasonCode = result?.reasonCode ?? 'inventory_cutoff_stale_preflight_data'
    const variant = line.variant?.trim() || result?.variantName?.trim() || 'This item'
    const guidance = reasonGuidance(reasonCode, variant, warehouse)
    affected.push({
      orderItemId,
      variantId: line.variant_id || result?.variantId || '',
      variant,
      variantCode: result?.variantCode ?? null,
      productCode: result?.productCode ?? null,
      quantity: Number(line.remaining_incoming_quantity || 0),
      warehouse,
      reasonCode,
      reason: guidance.reason,
      correctiveAction: guidance.correctiveAction,
    })
  }

  return {
    checked,
    eligibleCount: incomingTargetIds.length,
    blockedCount: affected.length,
    alreadyResolvedCount: actionable.length - unresolved.length - invalidSavedIncoming.length,
    unresolvedCount: unresolved.length + invalidSavedIncoming.length,
    incomingTargetIds,
    historyTargetIds,
    affected,
  }
}

export function h2mDecisionState(group: ManufacturerOrderGroup): H2mDecisionState {
  const actionable = actionableManufacturerLines(group)
  const saved = actionable
    .map(line => line.decision)
    .filter((decision): decision is ManufacturerDecision => Boolean(decision))
  const distinct = new Set(saved)
  return {
    appliedDecision:
      actionable.length > 0 && saved.length === actionable.length && distinct.size === 1
        ? saved[0]
        : null,
    mixed: distinct.size > 1,
    partial: saved.length > 0 && saved.length < actionable.length,
  }
}

export function h2mContinueGate(
  groups: ManufacturerOrderGroup[],
  eligibility: H2mIncomingEligibilityMap = {},
  warehouse = 'this warehouse',
  options?: {
    policyResolved?: boolean
    policyRequired?: boolean
    policy?: 'exclude_all' | 'review_select' | null
  },
) {
  const policyRequired = Boolean(options?.policyRequired)
  const policyResolved = Boolean(options?.policyResolved)
  const policy = options?.policy ?? null

  if (policyRequired && !policyResolved) {
    return {
      canContinue: false,
      unresolvedCount: 1,
      firstUnresolvedKey: groups[0]?.key ?? null,
      message: 'Save an H2M policy (Start Fresh or Review Orders) before continuing.',
    }
  }

  if (policyResolved && policy === 'exclude_all') {
    return {
      canContinue: true,
      unresolvedCount: 0,
      firstUnresolvedKey: null,
      message: null,
    }
  }

  const unresolvedCount = groups.reduce(
    (sum, group) => sum + h2mOrderEligibility(group, eligibility, warehouse).unresolvedCount,
    0,
  )
  const firstUnresolvedKey =
    groups.find(
      group => h2mOrderEligibility(group, eligibility, warehouse).unresolvedCount > 0,
    )?.key ?? null
  return {
    canContinue: unresolvedCount === 0,
    unresolvedCount,
    firstUnresolvedKey,
    message: unresolvedCount === 0
      ? null
      : `Resolve ${unresolvedCount} H2M item decision${unresolvedCount === 1 ? '' : 's'} before continuing.`,
  }
}
