import { describe, expect, it } from 'vitest'
import { groupManufacturerOrders, type ManufacturerLine } from './opening-balance-workspace'
import {
  h2mContinueGate,
  h2mDecisionState,
  h2mOrderEligibility,
  type H2mIncomingEligibilityMap,
} from './opening-balance-h2m-preflight'

const line = (overrides: Partial<ManufacturerLine> = {}): ManufacturerLine => ({
  order_item_id: 'm1',
  order_number: 'ORD25000001',
  order_id: 'order-1',
  variant_id: 'variant-1',
  variant: 'Cosmos Black',
  manufacturer: 'Shenzhen',
  status: 'approved',
  ordered_quantity: 200,
  received_quantity: 0,
  remaining_incoming_quantity: 200,
  decision: null,
  ...overrides,
})

const result = (
  orderItemId: string,
  incomingAvailable: boolean,
  reasonCode = incomingAvailable ? 'eligible' : 'inventory_cutoff_configuration_missing',
) => ({
  orderItemId,
  variantId: `variant-${orderItemId}`,
  incomingAvailable,
  configId: incomingAvailable ? `config-${orderItemId}` : null,
  reasonCode,
})

describe('authoritative H2M Incoming presentation helpers', () => {
  it('uses authoritative exact-item results for eligible and blocked counts', () => {
    const [group] = groupManufacturerOrders([
      line(),
      line({ order_item_id: 'm2', variant_id: 'variant-2', variant: 'Misty Grey' }),
    ])
    const eligibility: H2mIncomingEligibilityMap = {
      m1: result('m1', true),
      m2: result('m2', false, 'inventory_cutoff_configuration_not_in_session_scope'),
    }
    const status = h2mOrderEligibility(group, eligibility, 'Balakong')
    expect(status.checked).toBe(true)
    expect(status.eligibleCount).toBe(1)
    expect(status.blockedCount).toBe(1)
    expect(status.incomingTargetIds).toEqual(['m1'])
    expect(status.historyTargetIds).toEqual(['m1', 'm2'])
    expect(status.affected[0].reason).toContain('immutable scope')
  })

  it('treats unknown/stale readiness as blocked, never eligible', () => {
    const [group] = groupManufacturerOrders([line()])
    const status = h2mOrderEligibility(group, {}, 'Balakong')
    expect(status.checked).toBe(false)
    expect(status.eligibleCount).toBe(0)
    expect(status.blockedCount).toBe(1)
    expect(status.affected[0].reasonCode).toBe('inventory_cutoff_stale_preflight_data')
  })

  it('excludes saved decisions from order-level mutation targets', () => {
    const [group] = groupManufacturerOrders([
      line({ decision: 'history_only' }),
      line({ order_item_id: 'm2', decision: null }),
    ])
    const status = h2mOrderEligibility(group, {
      m1: result('m1', true),
      m2: result('m2', true),
    }, 'Balakong')
    expect(status.alreadyResolvedCount).toBe(1)
    expect(status.incomingTargetIds).toEqual(['m2'])
    expect(status.historyTargetIds).toEqual(['m2'])
  })

  it.each([
    ['inventory_cutoff_configuration_missing', 'no stock configuration'],
    ['inventory_cutoff_configuration_inactive', 'none are active'],
    ['inventory_cutoff_configuration_wrong_warehouse', 'different warehouse'],
    ['inventory_cutoff_configuration_wrong_variant', 'different variant'],
    ['inventory_cutoff_configuration_not_receiving_eligible', 'order receiving'],
    ['inventory_cutoff_configuration_not_in_session_scope', 'immutable scope'],
    ['inventory_cutoff_configuration_ambiguous', 'multiple eligible'],
  ])('maps %s to a precise human reason', (reasonCode, expected) => {
    const [group] = groupManufacturerOrders([line()])
    const status = h2mOrderEligibility(group, {
      m1: result('m1', false, reasonCode),
    }, 'Balakong')
    expect(status.affected[0].reason).toContain(expected)
    expect(status.affected[0].correctiveAction.length).toBeGreaterThan(10)
  })

  it('derives full, partial and mixed state only from saved server decisions', () => {
    const [incoming] = groupManufacturerOrders([
      line({ decision: 'carry_forward_incoming' }),
      line({ order_item_id: 'm2', decision: 'carry_forward_incoming' }),
    ])
    expect(h2mDecisionState(incoming)).toEqual({
      appliedDecision: 'carry_forward_incoming',
      mixed: false,
      partial: false,
    })

    const [partial] = groupManufacturerOrders([
      line({ decision: 'carry_forward_incoming' }),
      line({ order_item_id: 'm2', decision: null }),
    ])
    expect(h2mDecisionState(partial).partial).toBe(true)
    expect(h2mDecisionState(partial).appliedDecision).toBeNull()

    const [mixed] = groupManufacturerOrders([
      line({ decision: 'carry_forward_incoming' }),
      line({ order_item_id: 'm2', decision: 'history_only' }),
    ])
    expect(h2mDecisionState(mixed).mixed).toBe(true)
    expect(h2mDecisionState(mixed).appliedDecision).toBeNull()
  })

  it('blocks progression with an exact unresolved item count', () => {
    const groups = groupManufacturerOrders([
      line(),
      line({ order_item_id: 'm2', order_number: 'ORD25000002' }),
    ])
    const gate = h2mContinueGate(groups)
    expect(gate.canContinue).toBe(false)
    expect(gate.unresolvedCount).toBe(2)
    expect(gate.message).toBe('Resolve 2 H2M item decisions before continuing.')
    expect(gate.firstUnresolvedKey).toBe('ORD25000002')
  })
})
