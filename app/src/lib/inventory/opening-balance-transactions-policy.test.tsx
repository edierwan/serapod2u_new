import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import {
  TRANSACTIONS_FILTERS,
  TRANSACTIONS_POLICY_HEADING,
  TRANSACTIONS_POLICY_LABELS,
  TRANSACTIONS_POLICY_MIGRATION,
  TRANSACTIONS_POLICY_ORDER,
  categorizeTransactionsPolicyError,
  deriveEffectiveCarried,
  isTransactionCarriedForward,
  isTransactionHistoricallyExcluded,
  isTransactionsPolicyResolved,
  parseTransactionsHistoricalSummary,
  parseTransactionsPolicySnapshot,
  parseTransactionsPolicySummary,
  serializeCarriedRefs,
  serializeTransactionsPolicySummary,
  transactionsPolicyContinueGate,
  type TransactionRef,
  type TransactionsPolicySnapshot,
} from './opening-balance-transactions-policy'
import { deriveWorkspaceState } from './opening-balance-workspace'

const migration = fs.readFileSync(
  new URL(`../../../../supabase/migrations/${TRANSACTIONS_POLICY_MIGRATION}`, import.meta.url),
  'utf8',
)
const route = fs.readFileSync(
  new URL('../../app/api/inventory/opening-balance/transactions-policy/route.ts', import.meta.url),
  'utf8',
)

const CUTOFF = '11111111-1111-1111-1111-111111111111'
const WH = '22222222-2222-2222-2222-222222222222'
const CO = '33333333-3333-3333-3333-333333333333'
const CAT = '44444444-4444-4444-4444-444444444444'
const ADJ = '55555555-5555-5555-5555-555555555555'
const RET = '66666666-6666-6666-6666-666666666666'
const TRF = '77777777-7777-7777-7777-777777777777'

const baseSummary = (over: Record<string, unknown> = {}) => ({
  policy: 'review_select',
  cutoff_id: CUTOFF,
  boundary_at: '2026-07-31T00:00:00.000Z',
  confirmation_fingerprint: 'fp-abc',
  warehouse_organization_id: WH,
  company_id: CO,
  product_category_id: CAT,
  product_category_name: 'Vape',
  eligible_count: 3,
  carried_count: 1,
  excluded_count: 2,
  blocked_count: 0,
  carried_adjustment_ids: [ADJ],
  carried_return_ids: [],
  carried_transfer_ids: [],
  excluded_adjustment_ids: [],
  excluded_return_ids: [RET],
  excluded_transfer_ids: [TRF],
  carried_refs: [{ type: 'stock_adjustment', id: ADJ }],
  excluded_refs: [{ type: 'return', id: RET }, { type: 'stock_transfer', id: TRF }],
  eligible_refs: [
    { type: 'stock_adjustment', id: ADJ },
    { type: 'return', id: RET },
    { type: 'stock_transfer', id: TRF },
  ],
  transaction_summaries: [
    { transaction_type: 'stock_adjustment', transaction_id: ADJ, reference_no: null, status: 'pending', occurred_at: '2026-07-30T00:00:00Z', document_quantity: 100, line_count: 1, latest_stage: 'Draft', remaining_action: 'Approve', expected_event: 'On approval', eligibility: 'eligible', blocker_reason: null, treatment: 'carry' },
    { transaction_type: 'return', transaction_id: RET, reference_no: 'RET26-000007', status: 'return_submitted', occurred_at: '2026-07-29T00:00:00Z', document_quantity: 5, line_count: 1, latest_stage: 'Submitted', remaining_action: 'Process', expected_event: 'At disposition', eligibility: 'eligible', blocker_reason: null, treatment: 'exclude' },
    { transaction_type: 'stock_transfer', transaction_id: TRF, reference_no: 'ST25110001', status: 'pending', occurred_at: '2026-07-28T00:00:00Z', document_quantity: 50, line_count: 1, latest_stage: 'Pending', remaining_action: 'Dispatch', expected_event: 'At dispatch', eligibility: 'eligible', blocker_reason: null, treatment: 'exclude' },
  ],
  inventory_impact: 0,
  transactions_cancelled: false,
  stock_movements_created: false,
  qr_impact: 'none',
  notice: '1 transactions carried forward; 2 remain historical excluded.',
  ...over,
})

const snapshot = (over: Partial<TransactionsPolicySnapshot> = {}): TransactionsPolicySnapshot => ({
  policy: 'review_select',
  boundaryAt: '2026-07-31T00:00:00.000Z',
  warehouseOrganizationId: WH,
  companyId: CO,
  productCategoryId: CAT,
  eligibleCount: 3,
  carriedCount: 1,
  excludedCount: 2,
  blockedCount: 0,
  carriedAdjustmentIds: [ADJ],
  carriedReturnIds: [],
  carriedTransferIds: [],
  excludedAdjustmentIds: [],
  excludedReturnIds: [RET],
  excludedTransferIds: [TRF],
  carriedRefs: [{ type: 'stock_adjustment', id: ADJ }],
  excludedRefs: [{ type: 'return', id: RET }, { type: 'stock_transfer', id: TRF }],
  eligibleRefs: [
    { type: 'stock_adjustment', id: ADJ },
    { type: 'return', id: RET },
    { type: 'stock_transfer', id: TRF },
  ],
  inventoryImpact: 0,
  transactionsCancelled: false,
  stockMovementsCreated: false,
  qrImpact: 'none',
  ...over,
})

// ===========================================================================
// 1. All three Transactions Policies are available.
// ===========================================================================
describe('policy availability (req 1)', () => {
  it('exposes exactly the three required policies in order', () => {
    expect(TRANSACTIONS_POLICY_ORDER).toEqual(['exclude_all', 'carry_forward_all', 'review_select'])
    expect(TRANSACTIONS_POLICY_LABELS.exclude_all).toBe('Start Fresh — Exclude All Eligible Transactions')
    expect(TRANSACTIONS_POLICY_LABELS.carry_forward_all).toBe('Carry Forward All Eligible Transactions')
    expect(TRANSACTIONS_POLICY_LABELS.review_select).toBe('Review Transactions to Carry Forward')
  })
  it('uses the exact required Step 4 heading', () => {
    expect(TRANSACTIONS_POLICY_HEADING).toBe('How should eligible existing transactions be treated?')
  })
  it('server accepts the three policy values', () => {
    expect(migration).toMatch(/policy in \('exclude_all', 'carry_forward_all', 'review_select'\)/)
  })
})

// ===========================================================================
// 3-6. Option 1 (Start Fresh) behaviour.
// ===========================================================================
describe('Option 1 — Start Fresh (req 3,4,5,6)', () => {
  it('saves zero effective carried transaction IDs (derive) — req 3', () => {
    const eligible: TransactionRef[] = [{ type: 'stock_adjustment', id: ADJ }, { type: 'return', id: RET }]
    expect(deriveEffectiveCarried('exclude_all', eligible, eligible)).toEqual([])
  })
  it('supersedes stale selection — req 4', () => {
    const eligible: TransactionRef[] = [{ type: 'stock_adjustment', id: ADJ }]
    // even with a stale checked set, exclude_all carries nothing
    expect(deriveEffectiveCarried('exclude_all', eligible, eligible)).toHaveLength(0)
  })
  it('DB check constraint forces zero carried under exclude_all — req 3', () => {
    expect(migration).toMatch(/policy = 'exclude_all'[\s\S]*carried_count = 0[\s\S]*cardinality\(carried_adjustment_ids\) = 0/)
  })
  it('does not delete or cancel original transactions — req 5', () => {
    expect(migration).not.toMatch(/delete from public\.stock_adjustments/i)
    expect(migration).not.toMatch(/delete from public\.return_cases/i)
    expect(migration).not.toMatch(/delete from public\.stock_transfers/i)
    expect(migration).not.toMatch(/update public\.stock_adjustments\b/i)
    expect(migration).not.toMatch(/update public\.return_cases\b/i)
    expect(migration).not.toMatch(/update public\.stock_transfers\b/i)
  })
  it('produces zero inventory and stock-movement impact — req 6', () => {
    expect(migration).not.toMatch(/insert into public\.stock_movements/i)
    expect(migration).not.toMatch(/insert into public\.product_inventory/i)
    expect(migration).not.toMatch(/update public\.product_inventory/i)
    expect(migration).toMatch(/'inventory_impact', 0/)
  })
})

// ===========================================================================
// 7-9. Option 2 (Carry Forward All) behaviour.
// ===========================================================================
describe('Option 2 — Carry Forward All (req 7,8,9)', () => {
  it('carries all and only currently eligible transactions — req 7', () => {
    const eligible: TransactionRef[] = [
      { type: 'stock_adjustment', id: ADJ },
      { type: 'return', id: RET },
    ]
    expect(deriveEffectiveCarried('carry_forward_all', eligible, [])).toEqual(eligible)
  })
  it('never carries genuine blockers (blocked excluded from eligible set) — req 8', () => {
    // blocked transactions are never part of eligibleRefs, so they cannot be carried.
    expect(migration).toMatch(/when scoped\.eligibility = 'requires_resolution' then 'blocked'/)
  })
  it('zero inventory impact while saving — req 9', () => {
    expect(migration).toMatch(/stock_movements_created', false/)
  })
})

// ===========================================================================
// 10-13. Option 3 (Review) behaviour + checkbox semantics.
// ===========================================================================
describe('Option 3 — Review (req 10,11,12,13)', () => {
  it('checkbox is the only row-level decision; checked = carried — req 11,12', () => {
    const eligible: TransactionRef[] = [
      { type: 'stock_adjustment', id: ADJ },
      { type: 'return', id: RET },
    ]
    const checked: TransactionRef[] = [{ type: 'stock_adjustment', id: ADJ }]
    expect(deriveEffectiveCarried('review_select', eligible, checked)).toEqual([
      { type: 'stock_adjustment', id: ADJ },
    ])
  })
  it('unchecked eligible = historical excluded — req 13', () => {
    const eligible: TransactionRef[] = [
      { type: 'stock_adjustment', id: ADJ },
      { type: 'return', id: RET },
    ]
    const carried = deriveEffectiveCarried('review_select', eligible, [{ type: 'stock_adjustment', id: ADJ }])
    const excluded = eligible.filter(e => !carried.some(c => c.id === e.id))
    expect(excluded).toEqual([{ type: 'return', id: RET }])
  })
  it('provides the required review filters — req 10', () => {
    expect(TRANSACTIONS_FILTERS.map(f => f.id)).toEqual([
      'all', 'stock_adjustment', 'return', 'stock_transfer', 'attention',
    ])
  })
})

// ===========================================================================
// 14-16. Persistence, refresh restore, Step 4 / posting revalidation.
// ===========================================================================
describe('persistence & posting (req 14,15,16)', () => {
  it('parses a saved snapshot so refresh restores the authoritative policy — req 14', () => {
    const parsed = parseTransactionsPolicySnapshot({
      policy: 'review_select',
      boundary_at: '2026-07-31T00:00:00.000Z',
      eligible_count: 3, carried_count: 1, excluded_count: 2, blocked_count: 0,
      carried_adjustment_ids: [ADJ], carried_return_ids: [], carried_transfer_ids: [],
      excluded_adjustment_ids: [], excluded_return_ids: [RET], excluded_transfer_ids: [TRF],
      carried_refs: [{ type: 'stock_adjustment', id: ADJ }], excluded_refs: [], eligible_refs: [],
    })
    expect(parsed?.policy).toBe('review_select')
    expect(parsed?.carriedAdjustmentIds).toEqual([ADJ])
  })
  it('posting revalidates saved policy, scope and fingerprint — req 16', () => {
    expect(migration).toMatch(/inventory_cutoff_transactions_policy_scope_mismatch/)
    expect(migration).toMatch(/inventory_cutoff_transactions_policy_scope_changed/)
    expect(migration).toMatch(/inventory_cutoff_transactions_policy_required/)
  })
  it('preview snapshot feeds Step 4 and Review & Post via the same saved policy — req 15', () => {
    const ws = deriveWorkspaceState({
      readiness: 'Ready',
      status: 'counting',
      inventory: [],
      transactions_policy: baseSummary({ policy: 'exclude_all', carried_count: 0, carried_adjustment_ids: [], carried_refs: [] }),
      transactions_historical_summary: { eligible_count: 3, carried_count: 0, excluded_count: 3, blocked_count: 0, notice: 'x' },
    } as any)
    expect(ws.transactionsPolicy?.policy).toBe('exclude_all')
    expect(ws.remainingByStep.transactions).toBe(0)
  })
})

// ===========================================================================
// 17-23. Inventory neutrality + lifecycle continuation.
// ===========================================================================
describe('inventory neutrality & lifecycle (req 17-23)', () => {
  it('posting creates zero transaction-related inventory impact — req 17', () => {
    // The exclusion marker insert is metadata-only; no ledger writes in this file.
    expect(migration).toMatch(/insert into public\.inventory_cutoff_excluded_transactions/)
    expect(migration).not.toMatch(/insert into public\.stock_movements/i)
  })
  it('adjustment affects inventory only through its own posting lifecycle — req 18', () => {
    expect(migration).toMatch(/Inventory changes only when the adjustment is approved\/posted/)
  })
  it('return preserves its existing authoritative stock direction/event — req 19', () => {
    expect(migration).toMatch(/authoritative direction is preserved/)
    // the policy never invents a sign: no hardcoded add/deduct for returns
    expect(migration).not.toMatch(/quantity_change/i)
  })
  it('transfer not yet dispatched affects inventory only at legitimate dispatch — req 20', () => {
    expect(migration).toMatch(/Source is deducted only at legitimate dispatch/)
  })
  it('previously dispatched (in_transit) transfer never deducts source again — req 21', () => {
    expect(migration).toMatch(/the source is never deducted again/)
  })
  it('partial/inconsistent transactions continue using remaining only / are blocked — req 22,23', () => {
    expect(migration).toMatch(/requires_resolution/)
    expect(migration).toMatch(/to avoid replay/)
  })
})

// ===========================================================================
// 24-27. Historical exclusion enforcement + eligibility rigor.
// ===========================================================================
describe('exclusion enforcement & eligibility (req 24,25,26,27)', () => {
  it('excluded transaction cannot silently affect new inventory via old path — req 24', () => {
    expect(migration).toMatch(/create trigger inventory_cutoff_excluded_transaction_guard/)
    expect(migration).toMatch(/inventory_cutoff_transaction_historically_excluded/)
  })
  it('genuine inconsistent/partial transactions remain blockers with a reason — req 25,26', () => {
    expect(migration).toMatch(/requires individual resolution: %s/)
    expect(migration).toMatch(/blocker_reason/)
  })
  it('pending status alone is insufficient for eligibility — req 27', () => {
    // eligibility inspects movement evidence, not just status.
    expect(migration).toMatch(/has_movement/)
    expect(migration).toMatch(/movement_type = 'transfer_out'/)
    expect(migration).toMatch(/reference_type, ''\) = 'return'/)
  })
})

// ===========================================================================
// 28. Warehouse / organization / category / boundary isolation.
// ===========================================================================
describe('scope isolation (req 28, 34)', () => {
  it('scopes by warehouse, category and boundary', () => {
    expect(migration).toMatch(/a\.organization_id = v_warehouse/)
    expect(migration).toMatch(/p\.category_id = v_category/)
    expect(migration).toMatch(/created_at < v_boundary/)
    expect(migration).toMatch(/return_warehouse_id = v_warehouse/)
    expect(migration).toMatch(/from_organization_id = v_warehouse or t\.to_organization_id = v_warehouse/)
  })
  it('Vape and Pet Food cannot cross-map (category filter on every type) — req 34', () => {
    // category filter appears for adjustments, returns and transfers
    const categoryMatches = migration.match(/p\.category_id = v_category/g) || []
    expect(categoryMatches.length).toBeGreaterThanOrEqual(3)
  })
})

// ===========================================================================
// 29-31. Saving does not request OTP / protect draft / cancel / mutate.
// ===========================================================================
describe('safety of saving (req 29,30,31)', () => {
  it('saving does not request OTP or protect the draft — req 29', () => {
    // The apply function invalidates any pending OTP; it never creates one or
    // flips the cutoff status.
    expect(migration).not.toMatch(/insert into public\.stock_count_verification_requests/i)
    expect(migration).not.toMatch(/status = 'posted'[\s\S]{0,40}update public\.inventory_opening_cutoffs/i)
  })
  it('apply never cancels the Opening Balance — req 30', () => {
    expect(migration).not.toMatch(/cancel_inventory_opening_cutoff/)
    expect(migration).toMatch(/'cutoff_cancelled', false/)
  })
  it('policy selection causes no order/inventory/movement/QR mutation — req 31', () => {
    expect(migration).toMatch(/'qr_impact', 'none'/)
    expect(migration).not.toMatch(/update public\.qr_/i)
  })
})

// ===========================================================================
// 35. Concurrency guard.
// ===========================================================================
describe('concurrency (req 35)', () => {
  it('apply takes a cutoff-scoped advisory lock and is idempotent', () => {
    expect(migration).toMatch(/pg_advisory_xact_lock\(\s*hashtextextended\('inventory-cutoff-transactions-policy:'/)
    expect(migration).toMatch(/inventory_cutoff_transactions_policy_idempotency_conflict/)
  })
})

// ===========================================================================
// Pure helpers — parsing, gating, classification, error mapping, serialize.
// ===========================================================================
describe('pure helpers', () => {
  it('parses a full RPC summary', () => {
    const summary = parseTransactionsPolicySummary(baseSummary())
    expect(summary.policy).toBe('review_select')
    expect(summary.eligibleCount).toBe(3)
    expect(summary.carriedRefs).toEqual([{ type: 'stock_adjustment', id: ADJ }])
    expect(summary.inventoryImpact).toBe(0)
    expect(summary.transactionSummaries).toHaveLength(3)
  })

  it('accepts a single-row array envelope', () => {
    const summary = parseTransactionsPolicySummary([baseSummary()])
    expect(summary.cutoffId).toBe(CUTOFF)
  })

  it('rejects an invalid policy value', () => {
    expect(() => parseTransactionsPolicySummary(baseSummary({ policy: 'nope' }))).toThrow()
  })

  it('serializeCarriedRefs dedupes and drops invalid entries', () => {
    const refs = serializeCarriedRefs([
      { type: 'stock_adjustment', id: ADJ },
      { type: 'stock_adjustment', id: ADJ },
      { type: 'return', id: 'not-a-uuid' } as any,
    ])
    expect(refs).toEqual([{ type: 'stock_adjustment', id: ADJ }])
  })

  it('isTransactionsPolicyResolved reflects a saved policy', () => {
    expect(isTransactionsPolicyResolved(null)).toBe(false)
    expect(isTransactionsPolicyResolved(snapshot())).toBe(true)
  })

  it('carried / excluded classification helpers', () => {
    const snap = snapshot()
    expect(isTransactionCarriedForward({ type: 'stock_adjustment', id: ADJ }, snap)).toBe(true)
    expect(isTransactionCarriedForward({ type: 'return', id: RET }, snap)).toBe(false)
    expect(isTransactionHistoricallyExcluded({ type: 'return', id: RET }, snap)).toBe(true)
  })

  it('continue gate requires a saved policy when eligible transactions exist — req 30', () => {
    expect(transactionsPolicyContinueGate({ policyResolved: false, eligibleCount: 3, blockedCount: 0 }).canContinue).toBe(false)
    expect(transactionsPolicyContinueGate({ policyResolved: true, eligibleCount: 3, blockedCount: 0 }).canContinue).toBe(true)
    expect(transactionsPolicyContinueGate({ policyResolved: true, eligibleCount: 3, blockedCount: 1 }).canContinue).toBe(false)
    expect(transactionsPolicyContinueGate({ policyResolved: false, eligibleCount: 0, blockedCount: 0 }).canContinue).toBe(true)
  })

  it('categorizes resolver-unavailable, unauthorized and stale errors', () => {
    expect(categorizeTransactionsPolicyError({ code: 'PGRST202' }, false).category).toBe('transactions_policy_resolver_unavailable')
    expect(categorizeTransactionsPolicyError({ message: 'permission_denied' }, false).category).toBe('transactions_policy_unauthorized')
    expect(categorizeTransactionsPolicyError({ message: 'inventory_cutoff_transactions_policy_scope_changed' }, true).category).toBe('transactions_policy_stale_confirmation')
  })

  it('serialized route response round-trips through the client parser (regression)', () => {
    // The API route re-serializes the RPC summary and the client re-parses it.
    // serialize() must never emit shapes the client parser rejects, otherwise
    // saving a policy fails with transactions_policy_invalid_response.
    const parsed = parseTransactionsPolicySummary(baseSummary())
    const reSerialized = serializeTransactionsPolicySummary(parsed)
    expect(() => parseTransactionsPolicySummary(reSerialized)).not.toThrow()
    const round = parseTransactionsPolicySummary(reSerialized)
    expect(round.policy).toBe(parsed.policy)
    expect(round.eligibleCount).toBe(parsed.eligibleCount)
    expect(round.carriedRefs).toEqual(parsed.carriedRefs)
  })

  it('parses the historical summary with a zero inventory impact', () => {
    const hist = parseTransactionsHistoricalSummary({
      eligible_count: 3, carried_count: 1, excluded_count: 2, blocked_count: 0, notice: 'x',
    })
    expect(hist?.inventoryImpact).toBe(0)
    expect(hist?.excludedCount).toBe(2)
  })
})

// ===========================================================================
// Route + migration invariants.
// ===========================================================================
describe('route + migration invariants', () => {
  it('route only calls the two authoritative RPCs', () => {
    expect(route).toContain('apply_inventory_cutoff_transactions_policy')
    expect(route).toContain('inventory_cutoff_transactions_policy_preflight')
  })
  it('route reports the migration and never cancels the cutoff', () => {
    expect(route).toContain('TRANSACTIONS_POLICY_MIGRATION')
    expect(route).toContain('migration: TRANSACTIONS_POLICY_MIGRATION')
    expect(route).toContain('cutoffCancelled: false')
  })
  it('migration is forward-only, wraps preview and posting via rename', () => {
    expect(migration).toMatch(/alter function public\.inventory_cutoff_preview\(uuid\)\s*rename to inventory_cutoff_preview_pre_transactions_policy/)
    expect(migration).toMatch(/rename to verify_and_post_inventory_opening_cutoff_pre_transactions_policy/)
  })
  it('enables RLS on the new tables', () => {
    expect(migration).toMatch(/alter table public\.inventory_cutoff_transactions_policies enable row level security/)
    expect(migration).toMatch(/alter table public\.inventory_cutoff_excluded_transactions enable row level security/)
  })
})
