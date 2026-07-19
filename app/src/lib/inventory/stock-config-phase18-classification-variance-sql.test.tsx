import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../../supabase/migrations/20260719_stock_config_18_classification_allow_physical_variance.sql', import.meta.url),
  'utf8',
)
const phase16 = readFileSync(
  new URL('../../../../supabase/migrations/20260719_stock_config_16_classification_allocation_legacy_guards.sql', import.meta.url),
  'utf8',
)
const classificationLib = readFileSync(
  new URL('./stock-count-classification.ts', import.meta.url),
  'utf8',
)

describe('Phase 18 classification physical variance SQL + client contract', () => {
  it('is a forward-only migration that replaces the assert helper', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true)
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.stock_count_assert_classification_postable')
  })

  it('keeps allocation and already-fully-classified guards', () => {
    expect(migration).toContain("RAISE EXCEPTION 'stock_count_already_fully_classified:")
    expect(migration).toContain("RAISE EXCEPTION 'stock_count_allocated_blocks_post:")
    expect(migration).toContain('never auto-clear')
  })

  it('removes the exceeds-legacy block from the assert helper', () => {
    expect(migration).not.toContain('stock_count_classification_exceeds_legacy')
    expect(migration).toContain('genuine Stock Count variance')
    // Historical migration 16 still documents the old rule; phase 18 supersedes it.
    expect(phase16).toContain('stock_count_classification_exceeds_legacy')
  })

  it('documents OTP is not consumed when a guard raises and posting stays idempotent', () => {
    expect(migration).toContain('OTP is not consumed when a guard raises')
    expect(migration).toContain('draft-only session update keep it idempotent')
  })

  it('client mirror no longer rejects target totals above Legacy', () => {
    expect(classificationLib).toContain('genuine physical-count variance')
    expect(classificationLib).not.toContain("code: 'classification_exceeds_legacy'")
    expect(classificationLib).not.toContain('requestedTotal > liveOnHand')
  })
})
