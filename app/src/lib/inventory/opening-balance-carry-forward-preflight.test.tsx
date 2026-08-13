import { describe, expect, it } from 'vitest'
import { groupDistributorOrders, type DistributorLine } from './opening-balance-workspace'
import {
  CARRY_FORWARD_BLOCKED_EXPLANATION,
  carryForwardBlockedOrderItemIds,
  d2hCarryForwardStatus,
  d2hContinueGate,
  extractOpeningBalanceErrorCode,
  mapOpeningBalanceError,
  type CarryForwardEligibilityMap,
} from './opening-balance-carry-forward-preflight'

const blockedMap: CarryForwardEligibilityMap = {
  'oi-1': { orderItemId: 'oi-1', variantId: 'var-keladi', carryForwardAvailable: false, configId: null, reasonCode: 'inventory_cutoff_configuration_missing', variantName: 'Keladi', variantCode: 'KLD-20', productCode: 'PC-1' },
  'oi-mango': { orderItemId: 'oi-mango', variantId: 'var-mango', carryForwardAvailable: true, configId: 'cfg-mango', reasonCode: 'eligible' },
}

const submittedLine = (over: Partial<DistributorLine> = {}): DistributorLine => ({
  order_item_id: 'oi-1', order_number: 'SO1', status: 'submitted',
  variant_id: 'var-keladi', variant: 'Keladi', warehouse: 'Serapod Warehouse Balakong',
  quantity: 500, decision: null, ...over,
})

describe('d2hCarryForwardStatus', () => {
  it('flags an undecided order whose variant has no 20ml New Box target config', () => {
    const [group] = groupDistributorOrders([submittedLine()]).actionable
    const status = d2hCarryForwardStatus(group, blockedMap)
    expect(status.checked).toBe(true)
    expect(status.blocked).toBe(true)
    expect(status.affected).toHaveLength(1)
    expect(status.affected[0].variant).toBe('Keladi')
    expect(status.affected[0].warehouse).toBe('Serapod Warehouse Balakong')
    expect(status.affected[0].reason).toContain('Keladi')
    expect(status.affected[0].reason).toContain('Serapod Warehouse Balakong')
    expect(status.affected[0].variantCode).toBe('KLD-20')
  })

  it('does not block once the order carries an explicit resolving decision', () => {
    const [group] = groupDistributorOrders([submittedLine({ decision: 'do_not_carry_forward' })]).actionable
    const status = d2hCarryForwardStatus(group, blockedMap)
    // Config is still missing, but the order is resolved by another decision.
    expect(status.affected).toHaveLength(1)
    expect(status.blocked).toBe(false)
  })

  it('is not blocked when the target configuration is available', () => {
    const [group] = groupDistributorOrders([submittedLine({ order_item_id: 'oi-mango', variant_id: 'var-mango', variant: 'Mango' })]).actionable
    const status = d2hCarryForwardStatus(group, blockedMap)
    expect(status.blocked).toBe(false)
    expect(status.affected).toHaveLength(0)
  })

  it('reports unchecked until a preflight result exists for every submitted variant', () => {
    const [group] = groupDistributorOrders([submittedLine({ order_item_id: 'oi-unknown', variant_id: 'var-unknown' })]).actionable
    const status = d2hCarryForwardStatus(group, blockedMap)
    expect(status.checked).toBe(false)
    expect(status.blocked).toBe(false)
  })
})

describe('carryForwardBlockedOrderItemIds', () => {
  it('collects only the order-item ids that cannot carry forward', () => {
    const set = carryForwardBlockedOrderItemIds(blockedMap)
    expect(set.has('oi-1')).toBe(true)
    expect(set.has('oi-mango')).toBe(false)
  })
})

describe('d2hContinueGate', () => {
  it('blocks with an exact unresolved count while a decision remains', () => {
    const { actionable } = groupDistributorOrders([
      submittedLine({ order_number: 'SO1', order_item_id: 'a', decision: null }),
      submittedLine({ order_number: 'SO2', order_item_id: 'b', decision: 'cancel_release' }),
    ])
    const gate = d2hContinueGate(actionable)
    expect(gate.canContinue).toBe(false)
    expect(gate.unresolvedCount).toBe(1)
    expect(gate.message).toBe('Resolve 1 D2H order before continuing.')
    expect(gate.firstUnresolvedKey).toBe('SO1')
  })

  it('pluralises the message for multiple unresolved orders', () => {
    const { actionable } = groupDistributorOrders([
      submittedLine({ order_number: 'SO1', order_item_id: 'a', decision: null }),
      submittedLine({ order_number: 'SO2', order_item_id: 'b', decision: null }),
    ])
    const gate = d2hContinueGate(actionable)
    expect(gate.unresolvedCount).toBe(2)
    expect(gate.message).toBe('Resolve 2 D2H orders before continuing.')
  })

  it('allows continuing once every actionable order is decided', () => {
    const { actionable } = groupDistributorOrders([
      submittedLine({ order_number: 'SO1', order_item_id: 'a', decision: 'do_not_carry_forward' }),
    ])
    const gate = d2hContinueGate(actionable)
    expect(gate.canContinue).toBe(true)
    expect(gate.message).toBeNull()
  })
})

describe('error-code mapping', () => {
  it('extracts a known code from a raw supabase error message', () => {
    expect(extractOpeningBalanceErrorCode({ message: 'inventory_cutoff_20ml_new_box_missing' }))
      .toBe('inventory_cutoff_20ml_new_box_missing')
    expect(extractOpeningBalanceErrorCode('boom: organization_mismatch here')).toBe('organization_mismatch')
    expect(extractOpeningBalanceErrorCode('some unrelated failure')).toBeNull()
  })

  it('translates the 20ml New Box code into human guidance with context, never the raw code', () => {
    const mapped = mapOpeningBalanceError(
      { message: 'inventory_cutoff_20ml_new_box_missing' },
      { orderNumber: 'SO26000085', variant: 'Keladi', warehouse: 'Serapod Warehouse Balakong' },
    )
    expect(mapped.code).toBe('inventory_cutoff_20ml_new_box_missing')
    expect(mapped.title).toBe('Carry Forward unavailable')
    expect(mapped.message).toContain('Keladi')
    expect(mapped.message).toContain('Serapod Warehouse Balakong')
    expect(mapped.message).toContain('SO26000085')
    expect(mapped.message).not.toBe('inventory_cutoff_20ml_new_box_missing')
    expect(mapped.message).toContain('20 mg New Box')
  })

  it('gives a safe, actionable fallback for unknown errors and keeps a code slot', () => {
    const mapped = mapOpeningBalanceError(new Error('totally unexpected'))
    expect(mapped.code).toBe('unknown')
    expect(mapped.title).toBe('Could not apply decision')
    expect(mapped.message.length).toBeGreaterThan(0)
    expect(mapped.message).not.toContain('totally unexpected')
  })

  it.each([
    ['inventory_cutoff_configuration_inactive', 'Configuration inactive', 'inactive'],
    ['inventory_cutoff_configuration_wrong_warehouse', 'Wrong warehouse', 'same warehouse'],
    ['inventory_cutoff_configuration_wrong_variant', 'Variant mismatch', 'different product variant'],
    ['inventory_cutoff_configuration_not_order_eligible', 'Configuration not order-eligible', 'not enabled for distributor orders'],
    ['inventory_cutoff_configuration_not_in_session_scope', 'Configuration outside Opening Balance scope', 'immutable scope'],
    ['inventory_cutoff_configuration_ambiguous', 'Configuration is ambiguous', 'More than one'],
    ['inventory_cutoff_stale_preflight_data', 'Carry Forward check changed', 'no longer matches'],
  ])('maps %s to precise operator guidance', (code, title, messagePart) => {
    const mapped = mapOpeningBalanceError(
      new Error(code),
      { orderNumber: 'SO26000085', variant: 'Potato', warehouse: 'Balakong' },
    )
    expect(mapped.code).toBe(code)
    expect(mapped.title).toBe(title)
    expect(mapped.message).toContain(messagePart)
    expect(mapped.message).not.toBe(code)
  })

  it('exposes a stable explanation constant for the order-level banner', () => {
    expect(CARRY_FORWARD_BLOCKED_EXPLANATION).toContain('20 mg New Box')
  })
})
