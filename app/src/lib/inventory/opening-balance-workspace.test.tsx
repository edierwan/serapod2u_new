import { describe, expect, it } from 'vitest'
import {
  OPENING_BALANCE_STEPS,
  classifyActivityBucket,
  deriveWorkspaceState,
  distributorBulkTargets,
  distributorGroupDecisionState,
  groupDistributorOrders,
  groupManufacturerOrders,
  groupWarehouseActivity,
  manufacturerBulkTargets,
  matchesSearch,
  openingBalanceContinueLabel,
  type DistributorLine,
  type ManufacturerLine,
} from './opening-balance-workspace'

// ---------------------------------------------------------------------------
// Five-step model
// ---------------------------------------------------------------------------
describe('five-step workflow model', () => {
  it('exposes the five guided steps in order', () => {
    expect(OPENING_BALANCE_STEPS.map(s => s.id)).toEqual([
      'freeze', 'd2h', 'h2m', 'transactions', 'review',
    ])
  })

  it('labels the single Continue action for each step destination', () => {
    expect(openingBalanceContinueLabel('freeze')).toBe('Continue to D2H Orders')
    expect(openingBalanceContinueLabel('d2h')).toBe('Continue to H2M Incoming')
    expect(openingBalanceContinueLabel('h2m')).toBe('Continue to Transactions')
    expect(openingBalanceContinueLabel('transactions')).toBe('Continue to Review & Post')
    // The final step has no forward navigation (it posts instead).
    expect(openingBalanceContinueLabel('review')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// D2H grouping (task tests 3, 5, 6)
// ---------------------------------------------------------------------------
describe('D2H grouping', () => {
  const rows: DistributorLine[] = [
    { order_item_id: 'i1', order_number: 'SO-100', status: 'submitted', customer: 'ABC', warehouse: 'WH1', variant: 'Mango', quantity: 500, decision: null },
    { order_item_id: 'i2', order_number: 'SO-100', status: 'submitted', customer: 'ABC', warehouse: 'WH1', variant: 'Grape', quantity: 1000, decision: 'carry_forward' },
    { order_item_id: 'i3', order_number: 'SO-090', status: 'closed', customer: 'XYZ', warehouse: 'WH1', variant: 'Corn', quantity: 3, classification: 'History Only' },
    { order_item_id: 'i4', order_number: 'SO-110', status: 'shipped_distributor', customer: 'DEF', warehouse: 'WH1', variant: 'Nectar', quantity: 9, classification: 'Stock in Transit' },
  ]

  it('groups lines by order instead of one card per line', () => {
    const { actionable, historical } = groupDistributorOrders(rows)
    const so100 = actionable.find(g => g.orderNumber === 'SO-100')
    expect(so100?.lineCount).toBe(2)
    expect(so100?.totalQuantity).toBe(1500)
    expect(so100?.decisionsRemaining).toBe(1) // i1 undecided, i2 decided
    // one card per order, not per line
    expect(actionable.length + historical.length).toBe(3)
  })

  it('lists actionable (submitted) orders separately from historical/non-actionable', () => {
    const { actionable, historical } = groupDistributorOrders(rows)
    expect(actionable.map(g => g.orderNumber)).toEqual(['SO-100'])
    // closed + in-transit are both non-actionable
    expect(historical.map(g => g.orderNumber)).toEqual(['SO-090', 'SO-110'])
  })

  it('keeps a stable order across identical inputs', () => {
    const a = groupDistributorOrders(rows).actionable.map(g => g.key)
    const b = groupDistributorOrders([...rows].reverse()).actionable.map(g => g.key)
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// D2H bulk targets (task tests 8, 9)
// ---------------------------------------------------------------------------
describe('D2H order-level / bulk targets', () => {
  it('only targets submitted lines; never an ineligible line', () => {
    const lines: DistributorLine[] = [
      { order_item_id: 'i1', status: 'submitted' },
      { order_item_id: 'i2', status: 'shipped_distributor' },
      { order_item_id: 'i3', status: 'closed' },
      { order_item_id: 'i4', status: 'submitted' },
    ]
    expect(distributorBulkTargets(lines)).toEqual(['i1', 'i4'])
  })

  it('selects an order-level decision only when every eligible line saved the same value', () => {
    expect(distributorGroupDecisionState([
      { status: 'submitted', decision: 'carry_forward' },
      { status: 'submitted', decision: 'carry_forward' },
      { status: 'closed', decision: null },
    ])).toEqual({ appliedDecision: 'carry_forward', mixed: false })

    expect(distributorGroupDecisionState([
      { status: 'submitted', decision: 'carry_forward' },
      { status: 'submitted', decision: null },
    ])).toEqual({ appliedDecision: null, mixed: false })
  })

  it('reports mixed saved item decisions without selecting an order-level option', () => {
    expect(distributorGroupDecisionState([
      { status: 'submitted', decision: 'carry_forward' },
      { status: 'submitted', decision: 'cancel_release' },
    ])).toEqual({ appliedDecision: null, mixed: true })
  })
})

// ---------------------------------------------------------------------------
// H2M grouping (task test 4)
// ---------------------------------------------------------------------------
describe('H2M grouping', () => {
  const rows: ManufacturerLine[] = [
    { order_item_id: 'm1', order_number: 'ORD-1', manufacturer: 'Shenzhen', status: 'approved', ordered_quantity: 100, received_quantity: 40, remaining_incoming_quantity: 60, stock_config_id: 'cfg', decision: null },
    { order_item_id: 'm2', order_number: 'ORD-1', manufacturer: 'Shenzhen', status: 'approved', ordered_quantity: 50, received_quantity: 0, remaining_incoming_quantity: 50, stock_config_id: null, decision: null },
    { order_item_id: 'm3', order_number: 'ORD-2', manufacturer: 'Other', status: 'closed', ordered_quantity: 10, received_quantity: 10, remaining_incoming_quantity: 0, stock_config_id: 'cfg', decision: null },
  ]

  it('groups H2M lines by manufacturer order with aggregate quantities', () => {
    const groups = groupManufacturerOrders(rows)
    const ord1 = groups.find(g => g.orderNumber === 'ORD-1')
    expect(ord1?.lineCount).toBe(2)
    expect(ord1?.orderedQuantity).toBe(150)
    expect(ord1?.receivedQuantity).toBe(40)
    expect(ord1?.remainingIncoming).toBe(110)
    expect(ord1?.decisionsRemaining).toBe(2) // both eligible & undecided
    expect(ord1?.configIssues).toBe(1) // m2 has no config
  })

  it('does not count a fully-received line as an unresolved decision', () => {
    const ord2 = groupManufacturerOrders(rows).find(g => g.orderNumber === 'ORD-2')
    expect(ord2?.decisionsRemaining).toBe(0)
  })

  it('sorts newest first by created_at, then numeric sequence, deterministically', () => {
    const groups = groupManufacturerOrders([
      { order_id: 'old-3', order_item_id: 'm3', order_number: 'ORD25000003', status: 'approved', remaining_incoming_quantity: 1, order_created_at: '2025-12-01T00:00:00Z', order_sequence: 3 },
      { order_id: 'new-25', order_item_id: 'm25', order_number: 'ORD26000025', status: 'approved', remaining_incoming_quantity: 1, order_created_at: '2026-07-30T00:00:00Z', order_sequence: 25 },
      { order_id: 'new-26', order_item_id: 'm26', order_number: 'ORD26000026', status: 'approved', remaining_incoming_quantity: 1, order_created_at: '2026-07-30T00:00:00Z', order_sequence: 26 },
      { order_id: 'old-1', order_item_id: 'm1', order_number: 'ORD25000001', status: 'approved', remaining_incoming_quantity: 1, order_created_at: '2025-01-01T00:00:00Z', order_sequence: 1 },
    ])

    expect(groups.map(group => group.orderNumber)).toEqual([
      'ORD26000026',
      'ORD26000025',
      'ORD25000003',
      'ORD25000001',
    ])
  })
})

// ---------------------------------------------------------------------------
// H2M bulk targets — never overwrite ineligible/blocked (task tests 8, 9)
// ---------------------------------------------------------------------------
describe('H2M bulk targets', () => {
  const lines: ManufacturerLine[] = [
    { order_item_id: 'm1', status: 'approved', remaining_incoming_quantity: 60, stock_config_id: 'cfg' },
    { order_item_id: 'm2', status: 'approved', remaining_incoming_quantity: 50, stock_config_id: null }, // config missing
    { order_item_id: 'm3', status: 'approved', remaining_incoming_quantity: 0, stock_config_id: 'cfg' }, // fully received
  ]

  it('marks all eligible lines as history only regardless of config', () => {
    expect(manufacturerBulkTargets(lines, 'history_only')).toEqual(['m1', 'm2'])
  })

  it('excludes config-missing lines from carry-forward-incoming', () => {
    expect(manufacturerBulkTargets(lines, 'carry_forward_incoming')).toEqual(['m1'])
  })
})

// ---------------------------------------------------------------------------
// Operational transactions bucketing (task test — step 4)
// ---------------------------------------------------------------------------
describe('operational transaction bucketing', () => {
  it('separates must-resolve, safe and history-only transactions', () => {
    expect(classifyActivityBucket({ status: 'pending' })).toBe('mustResolve')
    expect(classifyActivityBucket({ status: 'draft' })).toBe('mustResolve')
    expect(classifyActivityBucket({ classification: 'Stock in Transit', status: 'shipped' })).toBe('safe')
    expect(classifyActivityBucket({ status: 'posted' })).toBe('history')
    expect(classifyActivityBucket({ status: 'cancelled' })).toBe('history')
    expect(classifyActivityBucket({ status: 'resolved' })).toBe('history')
    expect(classifyActivityBucket({ status: 'rejected' })).toBe('history')
    expect(classifyActivityBucket({ classification: 'History Only', status: 'draft' })).toBe('history')
    expect(classifyActivityBucket({})).toBe('history') // defaults to posted
  })

  it('groups a mixed activity list', () => {
    const groups = groupWarehouseActivity([
      { movement_type: 'repack', status: 'pending' },
      { movement_type: 'transfer', classification: 'Stock in Transit', status: 'shipped' },
      { movement_type: 'receive', status: 'posted' },
    ])
    expect(groups.mustResolve).toHaveLength(1)
    expect(groups.safe).toHaveLength(1)
    expect(groups.history).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Workspace state derivation (task tests 11, 13)
// ---------------------------------------------------------------------------
describe('workspace state derivation', () => {
  it('distinguishes remaining decisions per step and total blockers', () => {
    const state = deriveWorkspaceState({
      readiness: 'Blocked',
      inventory: [{ stock_config_id: 'c1', physical_quantity: 100 }],
      distributor_orders: [
        { order_number: 'SO-1', status: 'submitted', quantity: 5, decision: null, classification: 'Blocked' },
        { order_number: 'SO-2', status: 'submitted', quantity: 8, decision: 'carry_forward', classification: 'Carry Forward' },
      ],
      manufacturer_incoming: [
        { order_number: 'ORD-1', status: 'approved', remaining_incoming_quantity: 60, stock_config_id: 'cfg', decision: null },
      ],
      warehouse_activity: [{ movement_type: 'repack', status: 'pending' }],
      blockers: ['Physical count missing for Durian.'],
    })
    expect(state.physicalQuantity).toBe(100)
    expect(state.d2hRemaining).toBe(1)
    expect(state.h2mRemaining).toBe(1)
    expect(state.transactionsRemaining).toBe(1)
    expect(state.status).toBe('Blocked')
    expect(state.remainingByStep.review).toBe(3)
    // total blockers = undecided submitted order + server blocker message
    expect(state.totalBlockers).toBe(2)
  })

  it('reports Ready with zero remaining when everything is resolved', () => {
    const state = deriveWorkspaceState({
      readiness: 'Ready',
      inventory: [{ stock_config_id: 'c1', physical_quantity: 42 }],
      distributor_orders: [{ order_number: 'SO-2', status: 'submitted', quantity: 8, decision: 'carry_forward', classification: 'Carry Forward', has_active_allocation: true }],
      manufacturer_incoming: [],
      warehouse_activity: [],
      d2h_policy: {
        policy: 'review_select',
        boundary_at: '2026-07-31T00:00:00.000Z',
        eligible_order_count: 1,
        eligible_item_count: 1,
        eligible_quantity: 8,
        selected_order_count: 1,
        selected_item_count: 1,
        selected_quantity: 8,
        excluded_order_count: 0,
        excluded_item_count: 0,
        excluded_quantity: 0,
        eligible_order_ids: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
        selected_order_ids: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
        excluded_order_ids: [],
      },
    })
    expect(state.status).toBe('Ready')
    expect(state.d2hRemaining).toBe(0)
    expect(state.remainingByStep.review).toBe(0)
    expect(state.totalBlockers).toBe(0)
  })

  it('reports Completed once posted', () => {
    const state = deriveWorkspaceState({ status: 'posted', readiness: 'Ready', inventory: [] })
    expect(state.status).toBe('Completed')
  })
})

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
describe('search matching', () => {
  it('matches by order number, manufacturer or distributor, case-insensitively', () => {
    expect(matchesSearch(['SO-100', 'ABC Distributor'], 'abc')).toBe(true)
    expect(matchesSearch(['ORD-1', 'Shenzhen'], 'shen')).toBe(true)
    expect(matchesSearch(['SO-100', 'ABC'], 'nope')).toBe(false)
    expect(matchesSearch(['SO-100'], '')).toBe(true) // empty term matches all
  })
})
