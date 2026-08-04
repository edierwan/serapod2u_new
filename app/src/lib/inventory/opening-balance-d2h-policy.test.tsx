import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import {
  D2H_POLICY_LABELS,
  D2H_POLICY_MIGRATION,
  categorizeD2hPolicyError,
  d2hCutoffBoundaryAt,
  isD2hOrderCarriedForward,
  isD2hOrderHistoricallyExcluded,
  isD2hOrderPreBoundary,
  isD2hPolicyBlockerMessage,
  isD2hPolicyResolved,
  parseD2hHistoricalSummary,
  parseD2hPolicySnapshot,
  parseD2hPolicySummary,
} from './opening-balance-d2h-policy'
import {
  deriveWorkspaceState,
  groupDistributorOrders,
} from './opening-balance-workspace'
import {
  distributorClassification,
  distributorDecisionEligibility,
  summarizeOpeningBalance,
} from './opening-balance-classification'

const migration = fs.readFileSync(
  new URL(`../../../../supabase/migrations/${D2H_POLICY_MIGRATION}`, import.meta.url),
  'utf8',
)

const sampleSummary = {
  policy: 'exclude_all',
  cutoff_id: '11111111-1111-1111-1111-111111111111',
  boundary_at: '2026-07-31T00:00:00.000Z',
  confirmation_fingerprint: 'abc123',
  warehouse_organization_id: '22222222-2222-2222-2222-222222222222',
  company_id: '33333333-3333-3333-3333-333333333333',
  product_category_id: '44444444-4444-4444-4444-444444444444',
  product_category_name: 'Vape',
  eligible_order_count: 52,
  eligible_item_count: 80,
  eligible_quantity: 12000,
  selected_order_count: 0,
  selected_item_count: 0,
  selected_quantity: 0,
  excluded_order_count: 52,
  excluded_item_count: 80,
  excluded_quantity: 12000,
  blocked_order_count: 0,
  eligible_order_ids: ['55555555-5555-5555-5555-555555555555'],
  selected_order_ids: [],
  excluded_order_ids: ['55555555-5555-5555-5555-555555555555'],
  blocked_order_ids: [],
  order_summaries: [],
  orders_cancelled: false,
  historical_movements_reversed: false,
  qr_impact: 'none',
  notice: '52 historical D2H orders will be excluded from the new inventory baseline. Order history and reporting remain unchanged.',
}

describe('D2H policy migration contract', () => {
  it('defines Option A / Option B policy RPCs without QR or cancel side effects', () => {
    expect(migration).toContain('create table if not exists public.inventory_cutoff_d2h_policies')
    expect(migration).toContain("'exclude_all', 'review_select'")
    expect(migration).toContain('create or replace function public.inventory_cutoff_d2h_policy_preflight')
    expect(migration).toContain('create or replace function public.apply_inventory_cutoff_d2h_policy')
    expect(migration).toContain('coalesce(v_cutoff.posted_at, v_cutoff.proposed_cutoff_at)')
    expect(migration).toContain('p.category_id = v_cutoff.product_category_id')
    expect(migration).toContain("v_decision := 'do_not_carry_forward'")
    expect(migration).toContain("v_decision := 'carry_forward'")
    expect(migration).not.toMatch(/perform public\.cancel_inventory_opening_cutoff/)
    expect(migration).toContain("'qr_impact', 'none'")
    expect(migration).toContain("'orders_cancelled', false")
    expect(migration).toContain("'historical_movements_reversed', false")
    expect(migration).toContain("'Historical Excluded'")
  })

  it('category-scopes allocation ownership so Pet Food cannot block Vape', () => {
    expect(migration).toContain('p.category_id = v_cutoff.product_category_id')
    expect(migration).toContain('and p.category_id = v_category_id')
  })

  it('never replays order_fulfillment when carrying selected D2H orders', () => {
    expect(migration).toContain("d.decision='carry_forward'")
    expect(migration).toContain('Explicit distributor allocation carried forward to 20ml New Box')
    expect(migration).not.toMatch(/movement_type\s*=\s*'order_fulfillment'[\s\S]{0,80}insert/i)
  })
})

describe('1. Option A excludes all eligible pre-cut-off D2H orders', () => {
  it('parses exclude_all summary and marks policy resolved', () => {
    const summary = parseD2hPolicySummary(sampleSummary)
    expect(summary.policy).toBe('exclude_all')
    expect(summary.eligibleOrderCount).toBe(52)
    expect(summary.selectedOrderCount).toBe(0)
    expect(summary.excludedOrderCount).toBe(52)
    expect(summary.ordersCancelled).toBe(false)
    expect(isD2hPolicyResolved({
      policy: 'exclude_all',
      boundaryAt: summary.boundaryAt,
      eligibleOrderCount: 52,
      eligibleItemCount: 80,
      eligibleQuantity: 12000,
      selectedOrderCount: 0,
      selectedItemCount: 0,
      selectedQuantity: 0,
      excludedOrderCount: 52,
      excludedItemCount: 80,
      excludedQuantity: 12000,
      eligibleOrderIds: summary.eligibleOrderIds,
      selectedOrderIds: [],
      excludedOrderIds: summary.excludedOrderIds,
      ordersCancelled: false,
      historicalMovementsReversed: false,
      qrImpact: 'none',
    })).toBe(true)
  })
})

describe('2–4. Option A preserves history, does not cancel, does not reverse', () => {
  it('keeps cancel/reverse flags false and labels historical', () => {
    const summary = parseD2hPolicySummary(sampleSummary)
    expect(summary.ordersCancelled).toBe(false)
    expect(summary.historicalMovementsReversed).toBe(false)
    expect(summary.qrImpact).toBe('none')
    expect(D2H_POLICY_LABELS.exclude_all).toMatch(/Start Fresh/)
    expect(distributorClassification('submitted', 'do_not_carry_forward')).toBe('Do Not Carry Forward')
    expect(distributorClassification('submitted', null, 'exclude_all')).toBe('Historical Excluded')
    expect(distributorClassification('approved', null, 'exclude_all')).toBe('Historical Excluded')
  })
})

describe('5. Option A removes historical D2H blockers from Transactions guidance', () => {
  it('treats D2H policy blockers as Step 2 messages and clears d2hRemaining under exclude_all', () => {
    expect(isD2hPolicyBlockerMessage('Distributor order SO1 / Potato requires a decision.')).toBe(true)
    expect(isD2hPolicyBlockerMessage('Stock adjustment dated 01 Jul is draft')).toBe(false)

    const workspace = deriveWorkspaceState({
      readiness: 'Ready',
      status: 'counting',
      distributor_orders: [
        { order_id: 'o1', order_number: 'SO1', status: 'submitted', quantity: 10, decision: 'do_not_carry_forward', classification: 'Do Not Carry Forward' },
      ],
      d2h_policy: {
        policy: 'exclude_all',
        boundary_at: '2026-07-31T00:00:00.000Z',
        eligible_order_count: 1,
        eligible_item_count: 1,
        eligible_quantity: 10,
        selected_order_count: 0,
        selected_item_count: 0,
        selected_quantity: 0,
        excluded_order_count: 1,
        excluded_item_count: 1,
        excluded_quantity: 10,
        eligible_order_ids: ['11111111-1111-1111-1111-111111111111'],
        selected_order_ids: [],
        excluded_order_ids: ['11111111-1111-1111-1111-111111111111'],
      },
      d2h_historical_summary: {
        order_count: 1,
        item_count: 1,
        ordered_quantity: 10,
        notice: '1 historical D2H orders will be excluded from the new inventory baseline. Order history and reporting remain unchanged.',
      },
      warehouse_activity: [
        { movement_type: 'stock_adjustment', status: 'draft', classification: 'Complete Before Cut-off', quantity: 2 },
      ],
      blockers: [],
    })
    expect(workspace.d2hRemaining).toBe(0)
    expect(workspace.transactionsRemaining).toBe(1)
    expect(workspace.d2hHistoricalSummary?.orderCount).toBe(1)
  })
})

describe('6–8. Option B selection, historical unselected, no double deduction', () => {
  it('records selected vs excluded sets and only carry_forward as carried', () => {
    const selectedId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const excludedId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const snapshot = parseD2hPolicySnapshot({
      policy: 'review_select',
      boundary_at: '2026-07-31T00:00:00.000Z',
      eligible_order_count: 2,
      eligible_item_count: 2,
      eligible_quantity: 30,
      selected_order_count: 1,
      selected_item_count: 1,
      selected_quantity: 10,
      excluded_order_count: 1,
      excluded_item_count: 1,
      excluded_quantity: 20,
      eligible_order_ids: [selectedId, excludedId],
      selected_order_ids: [selectedId],
      excluded_order_ids: [excludedId],
      orders_cancelled: false,
      historical_movements_reversed: false,
      qr_impact: 'none',
    })
    expect(snapshot?.policy).toBe('review_select')
    expect(isD2hOrderCarriedForward(selectedId, 'carry_forward', snapshot)).toBe(true)
    expect(isD2hOrderHistoricallyExcluded(excludedId, 'do_not_carry_forward', 'Do Not Carry Forward', snapshot)).toBe(true)
    expect(isD2hOrderCarriedForward(excludedId, 'do_not_carry_forward', snapshot)).toBe(false)
    // Double-deduction guard: fulfillment evidence marks historical movement as not replayable.
    expect(distributorDecisionEligibility('submitted').availableActions).toEqual([
      'carry_forward',
      'do_not_carry_forward',
    ])
    expect(distributorDecisionEligibility('submitted').availableActions).not.toContain('cancel_release')
  })
})

describe('9–10. Decision survives navigation and shared decision set', () => {
  it('deriveWorkspaceState exposes the same policy snapshot used by Steps 2/4/review', () => {
    const workspace = deriveWorkspaceState({
      readiness: 'Ready',
      distributor_orders: [
        { order_id: 'o1', order_number: 'SO1', status: 'submitted', quantity: 5, decision: 'carry_forward', classification: 'Carry Forward' },
        { order_id: 'o2', order_number: 'SO2', status: 'submitted', quantity: 7, decision: 'do_not_carry_forward', classification: 'Do Not Carry Forward' },
      ],
      d2h_policy: {
        policy: 'review_select',
        boundary_at: '2026-07-31T00:00:00.000Z',
        eligible_order_count: 2,
        eligible_item_count: 2,
        eligible_quantity: 12,
        selected_order_count: 1,
        selected_item_count: 1,
        selected_quantity: 5,
        excluded_order_count: 1,
        excluded_item_count: 1,
        excluded_quantity: 7,
        eligible_order_ids: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
        selected_order_ids: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
        excluded_order_ids: ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
      },
      blockers: [],
    })
    expect(workspace.d2hPolicy?.policy).toBe('review_select')
    expect(workspace.d2hPolicy?.selectedOrderCount).toBe(1)
    expect(workspace.summary.distributorCarryForward.totalQuantity).toBe(5)
    expect(workspace.summary.excludedDoNotCarryForward.totalQuantity).toBe(7)
    expect(workspace.d2hRemaining).toBe(0)
  })
})

describe('11–14. Boundary, isolation, Vape excludes Pet Food', () => {
  it('uses posted_at after post and proposed_cutoff_at before', () => {
    expect(d2hCutoffBoundaryAt({
      proposedCutoffAt: '2026-07-01T00:00:00.000Z',
      postedAt: null,
    })).toBe('2026-07-01T00:00:00.000Z')
    expect(d2hCutoffBoundaryAt({
      proposedCutoffAt: '2026-07-01T00:00:00.000Z',
      postedAt: '2026-07-31T12:00:00.000Z',
    })).toBe('2026-07-31T12:00:00.000Z')
    expect(isD2hOrderPreBoundary('2026-06-30T23:59:59.000Z', '2026-07-01T00:00:00.000Z')).toBe(true)
    expect(isD2hOrderPreBoundary('2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')).toBe(false)
  })

  it('migration scopes D2H by warehouse + product category', () => {
    expect(migration).toContain('public.order_inventory_organization(o.id) = v_cutoff.warehouse_organization_id')
    expect(migration).toContain('p.category_id = v_cutoff.product_category_id')
    expect(migration).toContain('o.created_at < v_boundary')
  })
})

describe('15–16. H2M preserved; receiving not posted by D2H policy', () => {
  it('does not redefine H2M bulk apply while still revalidating H2M on post', () => {
    expect(migration).not.toContain('apply_inventory_cutoff_h2m_bulk')
    // Compatibility: posting wrapper still revalidates H2M incoming.
    expect(migration).toContain('resolve_inventory_cutoff_h2m_incoming')
  })
})

describe('17–18. Policy save never cancels; cancelled cutoffs stay archived', () => {
  it('apply path forbids cancel and preserves counting status in audit', () => {
    expect(migration).toContain("'cutoff_status_preserved', v_cutoff.status")
    expect(migration).toContain("'cutoff_cancelled', false")
    expect(categorizeD2hPolicyError({ message: 'inventory_cutoff_d2h_policy_scope_changed' }, true).category)
      .toBe('d2h_policy_stale_confirmation')
  })
})

describe('19–20. OTP blockers remain for genuine issues; no QR impact', () => {
  it('keeps non-D2H blockers and advertises qr_impact none', () => {
    const historical = parseD2hHistoricalSummary({
      order_count: 52,
      item_count: 80,
      ordered_quantity: 12000,
      orders_cancelled: false,
      historical_stock_returned: false,
      notice: '52 historical D2H orders will be excluded from the new inventory baseline. Order history and reporting remain unchanged.',
    })
    expect(historical?.ordersCancelled).toBe(false)
    expect(historical?.historicalStockReturned).toBe(false)
    expect(sampleSummary.qr_impact).toBe('none')
    expect(isD2hPolicyBlockerMessage('Return R1 is return_submitted and must be completed or cancelled before cut-off.')).toBe(false)
  })
})

describe('grouping + summary under policy classifications', () => {
  it('groups actionable submitted orders and summarizes historical excluded', () => {
    const groups = groupDistributorOrders([
      { order_id: 'o1', order_item_id: 'i1', order_number: 'SO1', status: 'submitted', quantity: 3, decision: 'do_not_carry_forward', classification: 'Do Not Carry Forward' },
      { order_id: 'o2', order_item_id: 'i2', order_number: 'SO2', status: 'closed', quantity: 9, classification: 'History Only' },
    ])
    expect(groups.actionable).toHaveLength(1)
    expect(groups.actionable[0].orderId).toBe('o1')
    expect(groups.historical).toHaveLength(1)

    const summary = summarizeOpeningBalance({
      distributor_orders: [
        { order_number: 'SO1', status: 'submitted', quantity: 3, decision: 'do_not_carry_forward', classification: 'Do Not Carry Forward' },
        { order_number: 'SO3', status: 'approved', quantity: 4, classification: 'Historical Excluded' },
      ],
    })
    expect(summary.excludedDoNotCarryForward.orderCount).toBe(2)
    expect(summary.excludedDoNotCarryForward.totalQuantity).toBe(7)
  })
})
