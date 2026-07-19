import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260719_stock_config_16_classification_allocation_legacy_guards.sql'),
  'utf8',
)

describe('Phase 16 classification allocation/legacy guards SQL contract', () => {
  it('defines stock_count_assert_classification_postable with the three business raises', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.stock_count_assert_classification_postable')
    expect(migration).toContain('stock_count_already_fully_classified')
    expect(migration).toContain('stock_count_allocated_blocks_post')
    expect(migration).toContain('stock_count_classification_exceeds_legacy')
    expect(migration).toContain('still has %s allocated')
    expect(migration).toContain('already been fully classified')
    expect(migration).toContain('requests %s units but only %s remain')
  })

  it('never auto-clears or moves allocations', () => {
    expect(migration).toMatch(/Do NOT auto-clear/i)
    expect(migration).not.toMatch(/quantity_allocated\s*=\s*0/)
    expect(migration).not.toMatch(/SET quantity_allocated/)
  })

  it('calls the assert from prepare and verify_and_post_stock_classification after locks', () => {
    expect(migration).toContain('PERFORM public.stock_count_assert_classification_postable')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.prepare_stock_count_verification')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.verify_and_post_stock_classification')
    expect(migration).toContain('FOR UPDATE OF pi')
  })

  it('preserves posting timeouts and EXECUTE grant on the classification post RPC', () => {
    expect(migration).toContain("SET statement_timeout TO '300s'")
    expect(migration).toContain("SET lock_timeout TO '30s'")
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.verify_and_post_stock_classification(uuid, text) TO authenticated')
  })
})
