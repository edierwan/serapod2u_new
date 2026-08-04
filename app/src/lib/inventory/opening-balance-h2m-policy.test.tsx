import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import {
  H2M_POLICY_LABELS,
  H2M_POLICY_MIGRATION,
  categorizeH2mPolicyError,
  isH2mOrderExpectedIncoming,
  isH2mOrderHistoricallyExcluded,
  isH2mPolicyBlockerMessage,
  isH2mPolicyResolved,
  parseH2mHistoricalSummary,
  parseH2mPolicySnapshot,
  parseH2mPolicySummary,
} from './opening-balance-h2m-policy'
import { deriveWorkspaceState } from './opening-balance-workspace'
import { h2mContinueGate } from './opening-balance-h2m-preflight'

const migration = fs.readFileSync(
  new URL(`../../../../supabase/migrations/${H2M_POLICY_MIGRATION}`, import.meta.url),
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
  eligible_order_count: 3,
  eligible_item_count: 8,
  eligible_ordered_quantity: 5200,
  eligible_received_before_boundary: 1000,
  eligible_outstanding_quantity: 4200,
  eligible_quantity: 4200,
  selected_order_count: 0,
  selected_item_count: 0,
  selected_ordered_quantity: 0,
  selected_received_before_boundary: 0,
  selected_outstanding_quantity: 0,
  selected_quantity: 0,
  excluded_order_count: 3,
  excluded_item_count: 8,
  excluded_ordered_quantity: 5200,
  excluded_received_before_boundary: 1000,
  excluded_outstanding_quantity: 4200,
  excluded_quantity: 4200,
  blocked_order_count: 0,
  eligible_order_ids: ['55555555-5555-5555-5555-555555555555'],
  selected_order_ids: [],
  excluded_order_ids: ['55555555-5555-5555-5555-555555555555'],
  blocked_order_ids: [],
  order_summaries: [],
  orders_cancelled: false,
  inventory_added: false,
  historical_movements_reversed: false,
  qr_impact: 'none',
  notice: '3 historical H2M orders will be excluded from expected incoming. Opening Balance posting adds zero H2M quantity. Order history remains unchanged.',
}

describe('H2M policy migration contract', () => {
  it('defines Option A / Option B policy RPCs without QR, cancel, or inventory side effects', () => {
    expect(migration).toContain('create table if not exists public.inventory_cutoff_h2m_policies')
    expect(migration).toContain("'exclude_all', 'review_select'")
    expect(migration).toContain('create or replace function public.inventory_cutoff_h2m_policy_preflight')
    expect(migration).toContain('create or replace function public.apply_inventory_cutoff_h2m_policy')
    expect(migration).toContain("v_decision := 'history_only'")
    expect(migration).toContain("v_decision := 'carry_forward_incoming'")
    expect(migration).toContain('manufacturer_order_excluded_history_only')
    expect(migration).not.toMatch(/perform public\.cancel_inventory_opening_cutoff/)
    expect(migration).toContain("'qr_impact', 'none'")
    expect(migration).toContain("'orders_cancelled', false")
    expect(migration).toContain("'inventory_added', false")
    expect(migration).toContain('inventory_cutoff_h2m_excluded_blocks_receipt')
    expect(migration).toContain("'inventory_posted',false")
  })

  it('preserves H2M order status under history_only and blocks carried-forward receipt revival', () => {
    expect(migration).toContain('order_status_preserved')
    expect(migration).toContain('future_receiving_via_cutoff_incoming')
    expect(migration).toContain('warehouse_receipt_h2m_excluded_guard')
    expect(migration).toContain('inventory_cutoff_h2m_policy_required')
    expect(migration).toContain('inventory_cutoff_h2m_policy_stale_incoming')
  })

  it('category-scopes H2M universe so Pet Food cannot map into Vape', () => {
    expect(migration).toContain('p.category_id = v_cutoff.product_category_id')
    expect(migration).toContain('resolve_inventory_cutoff_h2m_incoming')
  })
})

describe('H2M policy helpers', () => {
  it('2. Option A saves zero carried H2M order IDs and resolves Step 3', () => {
    const summary = parseH2mPolicySummary(sampleSummary)
    expect(summary.policy).toBe('exclude_all')
    expect(summary.selectedOrderIds).toEqual([])
    expect(summary.selectedOrderCount).toBe(0)
    expect(summary.ordersCancelled).toBe(false)
    expect(summary.inventoryAdded).toBe(false)
    expect(isH2mPolicyResolved({
      policy: 'exclude_all',
      boundaryAt: summary.boundaryAt,
      eligibleOrderCount: 3,
      eligibleItemCount: 8,
      eligibleQuantity: 4200,
      selectedOrderCount: 0,
      selectedItemCount: 0,
      selectedQuantity: 0,
      excludedOrderCount: 3,
      excludedItemCount: 8,
      excludedQuantity: 4200,
      eligibleOrderIds: summary.eligibleOrderIds,
      selectedOrderIds: [],
      excludedOrderIds: summary.excludedOrderIds,
      ordersCancelled: false,
      inventoryAdded: false,
      historicalMovementsReversed: false,
      qrImpact: 'none',
    })).toBe(true)
  })

  it('3. Option A overrides stale incoming decisions authoritatively', () => {
    const policy = parseH2mPolicySnapshot({
      ...sampleSummary,
      policy: 'exclude_all',
      selected_order_ids: [],
      selected_order_count: 0,
      selected_quantity: 0,
      selected_outstanding_quantity: 0,
    })
    // After exclude_all save, row decisions are rewritten to history_only and
    // selected IDs are empty — stale carry_forward_incoming cannot remain effective.
    expect(policy?.selectedOrderIds).toEqual([])
    expect(isH2mOrderExpectedIncoming('55555555-5555-5555-5555-555555555555', null, policy)).toBe(false)
    expect(isH2mOrderHistoricallyExcluded('55555555-5555-5555-5555-555555555555', 'history_only', null, policy)).toBe(true)
    expect(isH2mOrderHistoricallyExcluded('55555555-5555-5555-5555-555555555555', null, null, policy)).toBe(true)
  })

  it('9. Switching Option B to A leaves zero effective incoming selections', () => {
    const review = parseH2mPolicySnapshot({
      ...sampleSummary,
      policy: 'review_select',
      selected_order_count: 1,
      selected_item_count: 3,
      selected_quantity: 4200,
      selected_outstanding_quantity: 4200,
      selected_order_ids: ['55555555-5555-5555-5555-555555555555'],
      excluded_order_count: 0,
      excluded_order_ids: [],
    })
    expect(isH2mOrderExpectedIncoming('55555555-5555-5555-5555-555555555555', null, review)).toBe(true)

    const exclude = parseH2mPolicySnapshot({
      ...sampleSummary,
      policy: 'exclude_all',
      selected_order_ids: [],
      selected_order_count: 0,
      selected_quantity: 0,
      selected_outstanding_quantity: 0,
      excluded_order_ids: ['55555555-5555-5555-5555-555555555555'],
    })
    expect(exclude?.selectedOrderIds).toEqual([])
    expect(isH2mOrderExpectedIncoming('55555555-5555-5555-5555-555555555555', null, exclude)).toBe(false)
    expect(isH2mOrderHistoricallyExcluded('55555555-5555-5555-5555-555555555555', null, null, exclude)).toBe(true)
  })

  it('10/11. Refresh / workspace restores authoritative saved policy and remaining counts', () => {
    const workspace = deriveWorkspaceState({
      readiness: 'Ready',
      manufacturer_incoming: [
        {
          order_id: '55555555-5555-5555-5555-555555555555',
          order_item_id: '66666666-6666-6666-6666-666666666666',
          order_number: 'ORD26000026',
          status: 'approved',
          remaining_incoming_quantity: 4200,
          decision: 'history_only',
        },
      ],
      h2m_policy: sampleSummary,
      h2m_historical_summary: {
        order_count: 3,
        item_count: 8,
        ordered_quantity: 5200,
        received_before_boundary: 1000,
        outstanding_quantity: 4200,
        notice: sampleSummary.notice,
      },
    })
    expect(workspace.h2mPolicy?.policy).toBe('exclude_all')
    expect(workspace.h2mRemaining).toBe(0)
    expect(workspace.h2mHistoricalSummary?.outstandingQuantity).toBe(4200)
  })

  it('labels and blockers match Step 3 policy language', () => {
    expect(H2M_POLICY_LABELS.exclude_all).toMatch(/Start Fresh/)
    expect(H2M_POLICY_LABELS.review_select).toMatch(/Expected After Cut-off/)
    expect(isH2mPolicyBlockerMessage('An H2M policy is required before Opening Balance can be posted.')).toBe(true)
    expect(categorizeH2mPolicyError({ message: 'inventory_cutoff_h2m_policy_scope_changed' }, true).category)
      .toBe('h2m_policy_stale_confirmation')
  })

  it('continue gate treats exclude_all as resolved without per-order decisions', () => {
    const gate = h2mContinueGate([], {}, 'WH', {
      policyRequired: true,
      policyResolved: true,
      policy: 'exclude_all',
    })
    expect(gate.canContinue).toBe(true)
    expect(gate.unresolvedCount).toBe(0)
  })

  it('parses historical summary quantities for compact audit', () => {
    const summary = parseH2mHistoricalSummary({
      order_count: 3,
      item_count: 8,
      ordered_quantity: 5200,
      received_before_boundary: 1000,
      outstanding_quantity: 4200,
      notice: 'audit',
    })
    expect(summary?.receivedBeforeBoundary).toBe(1000)
    expect(summary?.outstandingQuantity).toBe(4200)
    expect(summary?.ordersCancelled).toBe(false)
    expect(summary?.inventoryAdded).toBe(false)
  })
})
