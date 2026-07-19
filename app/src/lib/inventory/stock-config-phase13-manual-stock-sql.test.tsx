import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260718_stock_config_13_manual_stock_addition.sql'),
  'utf8',
)

const canPost = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.manual_stock_addition_user_can_post'),
  migration.indexOf('COMMENT ON FUNCTION public.manual_stock_addition_user_can_post'),
)

const postFn = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.post_manual_stock_addition'),
  migration.indexOf('COMMENT ON FUNCTION public.post_manual_stock_addition'),
)

describe('Phase 13 manual stock addition SQL contracts', () => {
  it('authorizes HQ admin / adjust_stock and rejects unauthorized warehouse users server-side', () => {
    expect(canPost).toContain("? 'adjust_stock'")
    expect(canPost).toContain('public.is_hq_admin()')
    expect(canPost).toContain('public.can_access_org(p_warehouse_id)')
    expect(canPost).toContain("? 'adjust_stock'")
    expect(postFn).toContain('manual_stock_addition_user_can_post(v_user_id, p_organization_id)')
    expect(postFn).toContain('User is not authorized to post manual stock additions')
  })

  it('posts exact stock_config_id manual_in lines under one MSA batch reference', () => {
    expect(postFn).toContain("p_movement_type   => 'manual_in'")
    expect(postFn).toContain('p_stock_config_id => v_stock_config_id')
    expect(postFn).toContain("p_reference_type  => 'manual'")
    expect(postFn).toContain('p_reference_id    => p_request_id')
    expect(postFn).toContain('p_reference_no    => v_batch_no')
    expect(postFn).toContain("generate_display_doc_number(v_company_id, 'MSA')")
    expect(postFn).toContain('variant-only posting is not allowed')
  })

  it('rejects Legacy/Unclassified, inactive configs, non-positive quantities and duplicates', () => {
    expect(postFn).toContain("upper(coalesce(v_config.config_code, '')) = 'UNCLASSIFIED'")
    expect(postFn).toContain('Legacy/Unclassified stock cannot be selected')
    expect(postFn).toContain("coalesce(v_config.status, '') <> 'active'")
    expect(postFn).toContain('quantity must be a positive whole number')
    expect(postFn).toContain('duplicate stock configuration')
    expect(postFn).toContain('unit cost cannot be negative')
  })

  it('is atomic within one transaction and idempotent on client request id', () => {
    expect(postFn).toContain("pg_advisory_xact_lock(hashtextextended('manual-stock-addition:' || p_request_id::text, 0))")
    expect(postFn).toContain("reference_id = p_request_id")
    expect(postFn).toContain("'idempotent_replay', true")
    expect(postFn).toContain("'idempotent_replay', false")
    expect(postFn).toContain('EXCEPTION WHEN OTHERS THEN')
    expect(migration.trim().endsWith('COMMIT;')).toBe(true)
    expect(migration).not.toContain('ROLLBACK TO')
  })

  it('preserves WAC by delegating cost updates to record_stock_movement', () => {
    expect(postFn).toContain('public.record_stock_movement(')
    expect(postFn).toContain('p_unit_cost       => v_unit_cost')
    expect(postFn).not.toContain('average_cost =')
  })

  it('keeps movement reporting compatible with manual additions', () => {
    expect(postFn).toContain('p_reason          => v_reason')
    expect(postFn).toContain('p_created_by      => v_user_id')
    expect(postFn).toContain('External reference:')
    expect(postFn).toContain('Row note:')
  })
})
