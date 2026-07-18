import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260718_stock_config_09_full_count_classification_guard.sql'),
  'utf8',
)
const migration08 = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260717_stock_config_08_initial_classification.sql'),
  'utf8',
)

describe('Phase 9 Full-Count classification guard SQL contract', () => {
  it('is a forward-only migration wrapped in a single transaction', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true)
  })

  it('only ever CREATE OR REPLACEs prepare_stock_count_verification (no destructive DDL)', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.prepare_stock_count_verification')
    // It must not drop/alter/redefine any other Stock Count object.
    expect(migration).not.toMatch(/\bDROP\s+/i)
    expect(migration).not.toContain('verify_and_post_stock_count(')
    expect(migration).not.toContain('verify_and_post_stock_classification(')
  })

  it('blocks ordinary counts from classifying a nonzero Legacy/Unclassified balance', () => {
    expect(migration).toContain("v_session.count_type <> 'initial_configuration_classification'")
    expect(migration).toContain("c.config_code IN ('20NB', '50NB', '50OB')")
    expect(migration).toContain("lc.config_code = 'UNCLASSIFIED'")
    expect(migration).toContain('coalesce(lpi.quantity_on_hand, 0) > 0')
    expect(migration).toContain("RAISE EXCEPTION 'stock_count_full_count_on_unclassified'")
  })

  it('scopes the legacy-balance check to the session warehouse', () => {
    expect(migration).toContain('lpi.organization_id = v_session.warehouse_organization_id')
    expect(migration).toContain('lpi.is_active = true')
  })

  it('preserves every guard the migration-08 body already enforced', () => {
    // Regression: the re-created function must keep all prior invariants so a
    // verbatim-copy slip cannot silently drop an existing protection.
    for (const marker of [
      "RAISE EXCEPTION 'stock_count_config_identity_missing'",
      "RAISE EXCEPTION 'stock_count_snapshot_changed'",
      "RAISE EXCEPTION 'posting_note_required'",
      "RAISE EXCEPTION 'stock_count_base_cost_missing'",
      "RAISE EXCEPTION 'stock_count_classification_legacy_not_cleared'",
      "RAISE EXCEPTION 'stock_count_classification_incomplete'",
      'v_snapshot := public.stock_count_snapshot_hash(p_session_id)',
    ]) {
      expect(migration08).toContain(marker)
      expect(migration).toContain(marker)
    }
  })

  it('re-grants execute only to authenticated after replacing the function', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.prepare_stock_count_verification(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.prepare_stock_count_verification(uuid, uuid, text, jsonb, jsonb) TO authenticated')
  })

  it("reloads PostgREST's schema cache so the replaced function is picked up", () => {
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'")
  })
})
