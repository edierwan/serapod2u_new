import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260717_stock_config_08_initial_classification.sql'),
  'utf8',
)
const verifyRoute = readFileSync(
  new URL('../../app/api/inventory/stock-count/verification/verify/route.ts', import.meta.url),
  'utf8',
)
const bulkEnableRoute = readFileSync(
  new URL('../../app/api/inventory/stock-configurations/bulk-enable/route.ts', import.meta.url),
  'utf8',
)

describe('Phase 8 Initial Configuration Classification SQL contract', () => {
  it('is a forward-only migration that never touches migrations 01-07', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true)
  })

  it('adds stock_classification to the reference-type allowlist alongside every prior value', () => {
    for (const value of [
      'manual', 'order', 'transfer', 'adjustment', 'purchase_order', 'return', 'campaign', 'repack',
      'order_config_change', 'order_cancel_reversal',
    ]) {
      expect(migration).toContain(`'${value}'::text`)
    }
    expect(migration).toContain("'stock_classification'::text")
  })

  it('adds the new count_type and status values without removing existing ones', () => {
    expect(migration).toContain("count_type IN ('full_count', 'cycle_count', 'spot_check', 'initial_configuration_classification')")
    expect(migration).toContain("status IN ('draft', 'posted', 'archived')")
  })

  it('requires the Legacy row counted at exactly 0 and all three targets present before a code can be requested', () => {
    expect(migration).toContain("count_type = 'initial_configuration_classification'")
    expect(migration).toContain("config_code = 'UNCLASSIFIED'")
    expect(migration).toContain('i.physical_quantity IS DISTINCT FROM 0')
    expect(migration).toContain("RAISE EXCEPTION 'stock_count_classification_legacy_not_cleared'")
    expect(migration).toContain("RAISE EXCEPTION 'stock_count_classification_incomplete'")
    expect(migration).toContain("target.config_code IN ('20NB', '50NB', '50OB')")
  })

  it('defines a dedicated classification posting function that never accepts the wrong count type', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.verify_and_post_stock_classification(p_request_id uuid, p_code_hash text)')
    expect(migration).toContain("v_session.count_type <> 'initial_configuration_classification'")
    expect(migration).toContain("RAISE EXCEPTION 'stock_count_wrong_posting_function'")
  })

  it('posts classification movements exclusively through record_stock_movement, one call per line', () => {
    const fnStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.verify_and_post_stock_classification')
    const fnEnd = migration.indexOf('COMMENT ON FUNCTION public.verify_and_post_stock_classification', fnStart)
    const body = migration.slice(fnStart, fnEnd)
    expect(body).toContain("PERFORM public.record_stock_movement(")
    expect(body).toContain("p_reference_type => 'stock_classification'")
    expect(body).toContain('p_stock_config_id => v_item.stock_config_id')
    expect(body).not.toMatch(/UPDATE\s+public\.product_inventory/i)
    expect(body).not.toMatch(/UPDATE\s+public\.stock_movements/i)
  })

  it('locks in the same advisory-lock-then-row-lock order as the general Stock Count posting function', () => {
    const fnStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.verify_and_post_stock_classification')
    const fnEnd = migration.indexOf('COMMENT ON FUNCTION public.verify_and_post_stock_classification', fnStart)
    const body = migration.slice(fnStart, fnEnd)
    const advisoryLock = body.indexOf('pg_advisory_xact_lock')
    const rowLock = body.indexOf('FOR UPDATE OF pi', advisoryLock)
    const snapshotCheck = body.indexOf('v_current_snapshot :=', rowLock)
    expect(advisoryLock).toBeGreaterThan(0)
    expect(rowLock).toBeGreaterThan(advisoryLock)
    expect(snapshotCheck).toBeGreaterThan(rowLock)
  })

  it('checks draft status before flipping to posted, guaranteeing idempotent re-posting is rejected', () => {
    const fnStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.verify_and_post_stock_classification')
    const fnEnd = migration.indexOf('COMMENT ON FUNCTION public.verify_and_post_stock_classification', fnStart)
    const body = migration.slice(fnStart, fnEnd)
    expect(body).toContain("WHERE id = v_session.id AND status = 'draft'")
    expect(body).toContain("IF NOT FOUND THEN RAISE EXCEPTION 'stock_count_already_posted'")
  })

  it('keeps enable_variant_stock_configurations unchanged in signature and default (transition) behaviour', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.enable_variant_stock_configurations(p_variant_id uuid)')
    expect(migration).toContain("public._enable_variant_stock_configurations_core(p_variant_id, 'transition')")
  })

  it('never creates a 20ml Old Box configuration or a fourth arbitrary combination', () => {
    expect(migration).not.toContain("'20OB'")
    expect(migration).toContain("(p_variant_id, '20NB'")
    expect(migration).toContain("'50NB', '50ml · New Box'")
    expect(migration).toContain("'50OB', '50ml · Old Box'")
  })

  it('bulk-enables idempotently with a per-variant failure boundary that does not abort the batch', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.bulk_enable_variant_stock_configurations(p_variant_ids uuid[])')
    expect(migration).toContain('FOREACH v_variant_id IN ARRAY')
    expect(migration).toContain('EXCEPTION WHEN OTHERS THEN')
    expect(migration).toContain("'error_count', v_error_count")
  })

  it('is HQ-admin-only for both bulk enablement and archiving', () => {
    const bulkStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.bulk_enable_variant_stock_configurations')
    const bulkEnd = migration.indexOf('COMMENT ON FUNCTION public.bulk_enable_variant_stock_configurations', bulkStart)
    expect(migration.slice(bulkStart, bulkEnd)).toContain('public.is_hq_admin()')
  })

  it('archives stale drafts only from draft status, never reactivating them', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.archive_stock_count_draft(p_session_id uuid)')
    expect(migration).toContain("v_session.status <> 'draft' THEN RAISE EXCEPTION 'stock_count_already_posted'")
    expect(migration).toContain("SET status = 'archived'")
  })

  it('the verify route dispatches to the classification posting function only for classification sessions', () => {
    expect(verifyRoute).toContain("select('id,status,count_type')")
    expect(verifyRoute).toContain("accessibleSession.count_type === 'initial_configuration_classification'")
    expect(verifyRoute).toContain("'verify_and_post_stock_classification'")
    expect(verifyRoute).toContain("'verify_and_post_stock_count'")
  })

  it('the bulk-enable route re-validates every variant id server-side and never trusts the client list', () => {
    expect(bulkEnableRoute).toContain('isCelleraVapeVariant')
    expect(bulkEnableRoute).toContain("rpc('bulk_enable_variant_stock_configurations'")
    expect(bulkEnableRoute).not.toMatch(/from\('inventory_stock_configurations'\)\s*\.insert/)
  })
})
