import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  parseOpeningBalanceBlockers,
  transactionStepBlockers,
  orphanAllocationBlockers,
} from './opening-balance-blockers'
import { deriveOpeningBalanceReadiness } from './opening-balance-readiness'

// ---------------------------------------------------------------------------
// The corrective migration under test: it must replace ONLY the public wrapper
// `inventory_cutoff_preview(uuid)` and split the allocation reconciliation into
// two query levels so no aggregate is nested inside the outer jsonb_agg().
// ---------------------------------------------------------------------------
const migration = fs.readFileSync(
  new URL(
    '../../../../supabase/migrations/20260801180000_inventory_cutoff_preview_nested_aggregate_fix.sql',
    import.meta.url,
  ),
  'utf8',
)

// The inner CTE body (where the sum() legitimately lives).
const cteBody =
  migration.match(/with alloc_recon as \(([\s\S]*?)\n  \)\n  select coalesce\(jsonb_agg/)?.[1] ?? ''
// The outer aggregate expression (jsonb_agg args) — must be aggregate-free.
const outerAgg =
  migration.match(/select coalesce\(jsonb_agg\(jsonb_build_object\(([\s\S]*?)into v_alloc_details/)?.[1] ?? ''

describe('inventory_cutoff_preview nested-aggregate corrective migration (SQL contract)', () => {
  it('replaces ONLY the public wrapper via create or replace and does not rename the chain', () => {
    expect(migration).toContain(
      'create or replace function public.inventory_cutoff_preview(p_cutoff_id uuid)',
    )
    // Never renames either preview function, never creates another _pre_* fn.
    expect(migration).not.toMatch(/alter function[\s\S]*rename to/i)
    expect(migration).not.toMatch(/create (or replace )?function public\.inventory_cutoff_preview_pre_/i)
    // Continues to call the existing base function unchanged.
    expect(migration).toContain(
      'public.inventory_cutoff_preview_pre_blocker_details(p_cutoff_id)',
    )
    // Must NOT rerun / reapply the already-applied 20260801160000 migration:
    // no drop/create of its base function and no DDL other than the wrapper.
    expect(migration).not.toMatch(/drop function[\s\S]*inventory_cutoff_preview_pre_blocker_details/i)
  })

  it('computes the summed reconciliation ONLY in the inner CTE (two-level design)', () => {
    expect(cteBody).toContain('coalesce(sum(d.quantity), 0)')
    // The inner grouped row exposes the required scalar reconciliation columns.
    for (const col of [
      'product_variant_id',
      'variant_name',
      'stock_config_id',
      'config_label',
      'allocated_quantity',
      'selected_quantity',
      'difference',
      'orphan',
      'warehouse_organization_id',
      'product_category_id',
      'cutoff_id',
      'source_order_id',
      'source_order_number',
    ]) {
      expect(cteBody).toContain(col)
    }
    expect(cteBody).toMatch(/group by[\s\S]*having pi\.quantity_allocated <> coalesce\(sum\(d\.quantity\), 0\)/)
  })

  it('never nests an aggregate inside the outer jsonb_agg()', () => {
    expect(outerAgg.length).toBeGreaterThan(0) // sanity: region resolved
    for (const agg of ['sum(', 'count(', 'max(', 'min(', 'avg(']) {
      expect(outerAgg).not.toContain(agg)
    }
    // The outer aggregate consumes only the CTE's scalar columns.
    expect(outerAgg).toContain('ar.allocated_quantity')
    expect(outerAgg).toContain('ar.selected_quantity')
    expect(outerAgg).toContain('ar.difference')
  })

  it('prevents quantity multiplication by construction', () => {
    // Source-order enrichment is a single-valued lateral (limit 1) so many order
    // items / stock movements never fan out the summed decision quantity.
    expect(cteBody).toMatch(/left join lateral \([\s\S]*limit 1\s*\) src on true/)
    // Decision rows are matched by EXACT variant + stock-config ownership.
    expect(cteBody).toContain('oi.variant_id = pi.variant_id')
    expect(cteBody).toContain('oi.stock_config_id = pi.stock_config_id')
  })

  it('mirrors the CATEGORY-SCOPED base blockers[] allocation predicate for 1:1 parity', () => {
    // Same predicates as the base allocation-ownership blocker (Pet Food must not
    // block Vape): org + allocated>0 + product category.
    expect(cteBody).toContain('pi.organization_id = v_cutoff.warehouse_organization_id')
    expect(cteBody).toContain('pi.quantity_allocated > 0')
    expect(cteBody).toContain('p.category_id = v_cutoff.product_category_id')
    // Identical reason text so blocker_details and blockers[] never diverge.
    expect(migration).toContain(
      'Allocation ownership does not reconcile for %s (%s): inventory allocated %s, selected order quantity %s.',
    )
  })

  it('excludes allocation strings from the generic detail slice (no double-count)', () => {
    expect(migration).toContain(
      "msg.value not like 'Allocation ownership does not reconcile for %'",
    )
    // The two slices are concatenated: other blockers, then enriched allocation.
    expect(migration).toContain('v_details := v_other_details || v_alloc_details')
  })

  it('preserves the full function contract', () => {
    expect(migration).toContain('returns jsonb')
    expect(migration).toContain('stable')
    expect(migration).toContain('security definer')
    expect(migration).toContain('set search_path = public, pg_temp')
    expect(migration).toContain('public.can_access_org(v_cutoff.warehouse_organization_id)')
    expect(migration).toContain("raise exception 'inventory_cutoff_not_found'")
    expect(migration).toContain(
      'grant execute on function public.inventory_cutoff_preview(uuid) to authenticated',
    )
    expect(migration).toContain("jsonb_build_object('blocker_details', v_details)")
  })

  it('is read-only — mutates no inventory, allocation, order, movement or QR data', () => {
    expect(migration).not.toMatch(
      /\b(insert into|update|delete from|truncate)\s+public\./i,
    )
    const qrDml = migration.match(
      /\b(?:insert\s+into|update|delete\s+from|truncate)\s+public\.(qr_[a-z0-9_]+|consumer_qr_scans|qr_verification_log)\b/gi,
    )
    expect(qrDml).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Behavioural regression over the structured contract the SQL produces. These
// exercise the shared blocker/readiness derivation Step 4 and Step 5 consume.
// ---------------------------------------------------------------------------

const allocationReason = (variant: string, config: string, allocated: number, selected: number) =>
  `Allocation ownership does not reconcile for ${variant} (${config}): inventory allocated ${allocated}, selected order quantity ${selected}.`

const allocationDetail = (variant: string, config: string, allocated: number, selected: number, extra: Record<string, unknown> = {}) => ({
  id: `allocation_reconciliation:${extra.product_variant_id ?? 'v'}:${extra.stock_config_id ?? 'c'}`,
  code: 'allocation_reconciliation',
  category: 'allocation_reconciliation',
  step: 'transactions',
  reason: allocationReason(variant, config, allocated, selected),
  action_label: 'Review Allocation',
  variant_name: variant,
  config_label: config,
  allocated_quantity: allocated,
  selected_quantity: selected,
  difference: allocated - selected,
  orphan: selected === 0,
  ...extra,
})

describe('structured blocker_details behaviour (2-level aggregation output)', () => {
  it('allocated 1 / selected 0 yields difference 1 and orphan true', () => {
    const [detail] = parseOpeningBalanceBlockers({
      blocker_details: [allocationDetail('Zero Edition [ Potato ]', '20ml New Box', 1, 0, {
        product_variant_id: 'var-1', stock_config_id: 'cfg-1',
      })],
    })
    expect(detail.identity.allocatedQuantity).toBe(1)
    expect(detail.identity.selectedQuantity).toBe(0)
    expect(detail.identity.difference).toBe(1)
    expect(detail.orphan).toBe(true)
    expect(detail.category).toBe('allocation_reconciliation')
    expect(detail.step).toBe('transactions')
  })

  it('summed multiple decision rows are represented as one scalar (allocated 3 / selected 3 → no residual mismatch object)', () => {
    // A matching allocation (sum of three related decision rows == allocated) is
    // filtered by the SQL HAVING clause, so it produces NO allocation detail.
    const details = parseOpeningBalanceBlockers({ blocker_details: [], blockers: [] })
    expect(details).toEqual([])
  })

  it('multiple mismatched variants produce separate detail objects', () => {
    const details = parseOpeningBalanceBlockers({
      blocker_details: [
        allocationDetail('Alpha [ Salt ]', '30ml', 2, 0, { product_variant_id: 'a', stock_config_id: 'ca' }),
        allocationDetail('Beta [ Sugar ]', '20ml', 5, 1, { product_variant_id: 'b', stock_config_id: 'cb' }),
      ],
    })
    expect(details).toHaveLength(2)
    expect(new Set(details.map(d => d.id)).size).toBe(2)
    expect(details[0].identity.difference).toBe(2)
    expect(details[1].identity.difference).toBe(4)
  })

  it('a matching allocation produces no allocation-reconciliation blocker', () => {
    const details = parseOpeningBalanceBlockers({ blocker_details: [] })
    expect(orphanAllocationBlockers(details)).toEqual([])
  })

  it('a cutoff without blockers returns valid empty arrays', () => {
    expect(parseOpeningBalanceBlockers({ blocker_details: [], blockers: [] })).toEqual([])
    const readiness = deriveOpeningBalanceReadiness(baseReadinessInput({ serverReadiness: 'Ready' }))
    expect(readiness.ready).toBe(true)
    expect(readiness.blockerCount).toBe(0)
  })

  it('legacy blockers[] remains available (pre-migration fallback classifies the string)', () => {
    const [detail] = parseOpeningBalanceBlockers({
      blockers: [allocationReason('Gamma [ Mint ]', '10ml', 4, 1)],
    })
    expect(detail.category).toBe('allocation_reconciliation')
    expect(detail.identity.allocatedQuantity).toBe(4)
    expect(detail.identity.selectedQuantity).toBe(1)
    expect(detail.identity.difference).toBe(3)
  })

  it('structured blocker_details[] supersedes legacy blockers[] when both present', () => {
    const details = parseOpeningBalanceBlockers({
      blocker_details: [allocationDetail('Struct [ X ]', '20ml', 9, 2, { product_variant_id: 's', stock_config_id: 'cs' })],
      blockers: ['some stale legacy string that must be ignored'],
    })
    expect(details).toHaveLength(1)
    expect(details[0].identity.difference).toBe(7)
  })
})

function baseReadinessInput(overrides: Partial<Parameters<typeof deriveOpeningBalanceReadiness>[0]> = {}) {
  return {
    serverReadiness: 'Blocked' as const,
    d2hRequired: false,
    d2hPolicyResolved: true,
    d2hUndecidedLines: 0,
    h2mRequired: false,
    h2mPolicyResolved: true,
    h2mUndecidedLines: 0,
    transactionsRequired: false,
    transactionsPolicyResolved: true,
    ...overrides,
  }
}

describe('Step 4 / Step 5 parity and OTP gating', () => {
  it('Step 4 and Step 5 consume the same blocker collection (count parity)', () => {
    const blockerDetails = [
      { reason: 'A distributor line requires individual resolution.' },
      allocationDetail('Delta [ Basil ]', '20ml', 1, 0, { product_variant_id: 'd', stock_config_id: 'cd' }),
    ]
    const step5 = deriveOpeningBalanceReadiness(baseReadinessInput({
      serverReadiness: 'Blocked',
      serverBlockerDetails: blockerDetails,
    }))
    const parsed = parseOpeningBalanceBlockers({ blocker_details: blockerDetails })
    // Step 5 count == number of structured details (no blocker lost, none duplicated).
    expect(step5.blockerCount).toBe(2)
    // Both blockers resolve on the Transactions step — Step 4 renders the same set.
    expect(transactionStepBlockers(parsed)).toHaveLength(2)
    // The allocation blocker gets its own reconciliation card (the one previously hidden).
    const allocationCards = orphanAllocationBlockers(parsed)
    expect(allocationCards).toHaveLength(1)
    expect(allocationCards[0].category).toBe('allocation_reconciliation')
  })

  it('OTP stays unavailable while a genuine blocker exists', () => {
    const readiness = deriveOpeningBalanceReadiness(baseReadinessInput({
      serverReadiness: 'Blocked',
      serverBlockerDetails: [allocationDetail('Echo [ Lime ]', '20ml', 1, 0, { product_variant_id: 'e', stock_config_id: 'ce' })],
    }))
    expect(readiness.ready).toBe(false) // component gates the OTP button on readiness.ready
    expect(readiness.blockerCount).toBeGreaterThanOrEqual(1)
  })

  it('a genuinely ready cutoff enables OTP (readiness.ready true, zero blockers)', () => {
    const readiness = deriveOpeningBalanceReadiness(baseReadinessInput({ serverReadiness: 'Ready' }))
    expect(readiness.ready).toBe(true)
    expect(readiness.blockers).toEqual([])
  })
})

describe('duplicate preview toast is deduplicated on the client', () => {
  const section = fs.readFileSync(
    new URL('../../components/inventory/InventoryOpeningCutoffSection.tsx', import.meta.url),
    'utf8',
  )

  it('guards the initial auto-preview so a single failed load never toasts twice', () => {
    // A ref keyed by cut-off id makes the mount effect idempotent under React 18
    // StrictMode double-invoke and report-null re-renders.
    expect(section).toContain('autoPreviewRef')
    expect(section).toMatch(/autoPreviewRef\.current !== id/)
    expect(section).toMatch(/autoPreviewRef\.current = id/)
  })
})
