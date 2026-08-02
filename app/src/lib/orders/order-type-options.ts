// ============================================================================
// Create-Order "Select Order Type" options (pure, UI-agnostic).
// ----------------------------------------------------------------------------
// One deterministic source of truth for which order-type cards the Create Order
// modal shows and in what order. Keeping this pure removes the two causes of the
// modal "flip"/flicker that could change what the cards look like frame to frame:
//   * option ORDER is fixed here (H2M, then D2H, then S2D) — never re-sorted.
//   * option VISIBILITY depends only on synchronous org-type + role-level facts,
//     never on the async permission-loading flag, so the set cannot flash
//     between "with H2M" and "without H2M" while permissions resolve.
// Each option carries a STABLE key so React never remounts a card on re-render.
// ============================================================================

import { canCreateH2MOrder } from '@/modules/supply-chain/h2m-access'

export type CreateOrderTypeId = 'h2m' | 'd2h' | 's2d'

/** The routing target the parent navigates to when a card is chosen. */
export type CreateOrderTypeTarget = 'create-order' | 'distributor-order' | 'shop-order'

export interface CreateOrderTypeOption {
  /** Stable React key / identity — never derived from array position. */
  id: CreateOrderTypeId
  title: string
  description: string
  target: CreateOrderTypeTarget
}

// Fixed authoring order. The array is frozen so nothing can re-sort it in place.
const ALL_ORDER_TYPE_OPTIONS: readonly CreateOrderTypeOption[] = Object.freeze([
  {
    id: 'h2m',
    title: 'HQ Order to Manufacture (H2M)',
    description: 'Create an order from Headquarters to a manufacturer.',
    target: 'create-order',
  },
  {
    id: 'd2h',
    title: 'Order to HQ (D2H)',
    description: 'Order products from headquarters using distributor pricing (only products with available stock)',
    target: 'distributor-order',
  },
  {
    id: 's2d',
    title: 'Shop Order (S2D)',
    description: 'Create order for Shop from Distributor using retailer pricing (deducts from Distributor inventory)',
    target: 'shop-order',
  },
])

export interface CreateOrderTypeAuthzInput {
  orgTypeCode: string | null | undefined
  roleLevel: number | null | undefined
}

/**
 * The stable, ordered list of order-type options the current user may create.
 * Only H2M is gated (Headquarters + sufficient role level); D2H and S2D remain
 * available to the distributor/warehouse/HQ users who reach this modal. The
 * result order is always a subset of the fixed authoring order.
 */
export function resolveCreateOrderTypeOptions(input: CreateOrderTypeAuthzInput): CreateOrderTypeOption[] {
  const canCreateH2M = canCreateH2MOrder(input.orgTypeCode, input.roleLevel)
  return ALL_ORDER_TYPE_OPTIONS.filter(option => option.id !== 'h2m' || canCreateH2M)
}
