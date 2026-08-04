import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) =>
  fs.readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')

const migration = repoFile('supabase/migrations/20260801230000_allow_opening_balance_cutoff_stock_movement_reference.sql')
// The previous authoritative definition of the allowlist (live == this).
const prior = repoFile('supabase/migrations/20260717_stock_config_08_initial_classification.sql')
const resolver220 = repoFile('supabase/migrations/20260801220000_fix_inventory_cutoff_allocation_resolver_frozen_release.sql')

// The ARRAY[...] block of the new CHECK constraint.
const newArray = migration.match(/add constraint stock_movements_reference_type_check check \(\s*reference_type = any \(array\[([\s\S]*?)\]\)/i)?.[1] ?? ''
// Every quoted value inside that block.
const newValues = [...newArray.matchAll(/'([a-z_]+)'::text/g)].map(m => m[1])

// Every value the prior (live) constraint allowed.
const priorArray = prior.match(/add constraint stock_movements_reference_type_check check \(\s*reference_type = any \(array\[([\s\S]*?)\]\)/i)?.[1] ?? ''
const priorValues = [...priorArray.matchAll(/'([a-z_]+)'::text/g)].map(m => m[1])

describe('stock_movements reference_type allowlist — opening_balance_cutoff', () => {
  it('is forward-only: drops then re-adds the same constraint, wrapped in a transaction', () => {
    expect(migration.trim().toLowerCase().startsWith('begin;')).toBe(true)
    expect(migration.trim().toLowerCase().endsWith('commit;')).toBe(true)
    expect(migration).toMatch(/drop constraint if exists stock_movements_reference_type_check/i)
    expect(migration).toMatch(/add constraint stock_movements_reference_type_check check/i)
  })

  it('accepts opening_balance_cutoff', () => {
    expect(newValues).toContain('opening_balance_cutoff')
  })

  it('preserves EVERY previously allowed value (none removed or renamed)', () => {
    // The prior live allowlist (sanity: the exact 11 documented values).
    expect(priorValues).toEqual([
      'manual', 'order', 'transfer', 'adjustment', 'purchase_order', 'return',
      'campaign', 'repack', 'order_config_change', 'order_cancel_reversal', 'stock_classification',
    ])
    for (const value of priorValues) {
      expect(newValues).toContain(value)
    }
    // New set is exactly the prior set plus the one addition — nothing else.
    expect(new Set(newValues)).toEqual(new Set([...priorValues, 'opening_balance_cutoff']))
    expect(newValues).toHaveLength(priorValues.length + 1)
  })

  it('remains a CLOSED allowlist so any unknown reference_type stays rejected', () => {
    // A fixed ANY(ARRAY[...]) membership test — not a catch-all / regex / NULL gap.
    expect(migration).toMatch(/reference_type = any \(array\[/i)
    expect(newValues).not.toContain('opening_balance') // near-miss stays out
    expect(newValues).not.toContain('bogus_reference')
  })

  it('is consistent with the resolver: the value the resolver writes is now allowed', () => {
    // 220000 inserts the audited deallocation with reference_type 'opening_balance_cutoff'.
    expect(resolver220).toContain("'deallocation', 'opening_balance_cutoff'")
    const written = resolver220.match(/'deallocation', '([a-z_]+)'/)?.[1]
    expect(written).toBe('opening_balance_cutoff')
    expect(newValues).toContain(written)
  })

  it('the resolver still creates exactly one audited deallocation and never touches on-hand / average_cost', () => {
    // Re-assert the release invariants so the constraint fix cannot mask a
    // regression: exactly one deallocation movement, no quantity_on_hand /
    // average_cost writes on the release path, idempotent (no double-release).
    const excludeBranch = resolver220.match(/else -- exclude_and_release([\s\S]*?)end if;\s*\n\s*-- Recompute/i)?.[1] ?? ''
    expect((resolver220.match(/'deallocation', 'opening_balance_cutoff'/g) ?? [])).toHaveLength(1)
    expect(excludeBranch).not.toMatch(/quantity_on_hand\s*=/)
    expect(excludeBranch).not.toMatch(/average_cost\s*=/)
    // Idempotency: an identical request replays the stored result rather than releasing twice.
    expect(resolver220).toContain("return v_existing.result || jsonb_build_object('idempotent_replay', true)")
  })
})
