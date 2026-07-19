import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Requirement: "Do not fix only the UI while database posting still assumes
// every Legacy flavour is selected." These assertions pin the server-side
// contract that makes partial classification safe: prepare/verify/posting act
// ONLY on the rows persisted for the session (i.e. the selected flavours), and
// any persisted Legacy/Unclassified row must be fully classified. A deferred
// flavour is simply never persisted, so it is never validated, hashed, or moved.
const migration = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260717_stock_config_08_initial_classification.sql'),
  'utf8',
)
const fullCountGuardMigration = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260718_stock_config_09_full_count_classification_guard.sql'),
  'utf8',
)

function fnBody(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  expect(start).toBeGreaterThan(-1)
  const end = migration.indexOf('$$;', start)
  expect(end).toBeGreaterThan(start)
  return migration.slice(start, end)
}

describe('Classification selection is enforced by the DB, not just the UI', () => {
  it('the incompleteness guard is scoped to persisted UNCLASSIFIED rows only', () => {
    const prepare = fnBody('prepare_stock_count_verification')
    // The guard iterates session items whose config_code is UNCLASSIFIED — i.e.
    // only flavours the client actually persisted (selected). A deferred flavour
    // has no persisted Legacy row, so it is never reached by this check.
    expect(prepare).toContain('FROM public.stock_count_session_items i')
    expect(prepare).toContain("c.config_code = 'UNCLASSIFIED'")
    expect(prepare).toContain("target.config_code IN ('20NB', '50NB', '50OB')")
    expect(prepare).toContain("RAISE EXCEPTION 'stock_count_classification_incomplete'")
    // Any persisted Legacy row must be cleared to exactly 0 (never a typed value).
    expect(prepare).toContain('i.physical_quantity IS DISTINCT FROM 0')
    expect(prepare).toContain("RAISE EXCEPTION 'stock_count_classification_legacy_not_cleared'")
  })

  it('posting moves only rows persisted for the session (selected flavours)', () => {
    const post = fnBody('verify_and_post_stock_classification')
    // The movement loop is scoped to the session's persisted items with a real
    // adjustment — deferred flavours are absent and cannot be moved.
    expect(post).toContain('WHERE i.session_id = v_session.id AND coalesce(i.adjustment_quantity, 0) <> 0')
    expect(post).toContain('PERFORM public.record_stock_movement(')
    // Defence in depth: the completeness guard is re-checked at posting time too.
    expect(post).toContain("RAISE EXCEPTION 'stock_count_classification_incomplete'")
    // The session summary is computed only from this session's items.
    expect(post).toContain('FROM public.stock_count_session_items WHERE session_id = v_session.id')
    // It never reads product_inventory for un-persisted (deferred) variants as a
    // source of legacy quantity to remove.
    expect(post).not.toContain('gross')
  })
})

describe('Ordinary counts cannot classify a Legacy balance', () => {
  it('migration 09 blocks counted targets while UNCLASSIFIED stock remains', () => {
    expect(fullCountGuardMigration).toContain("v_session.count_type <> 'initial_configuration_classification'")
    expect(fullCountGuardMigration).toContain("c.config_code IN ('20NB', '50NB', '50OB')")
    expect(fullCountGuardMigration).toContain("lc.config_code = 'UNCLASSIFIED'")
    expect(fullCountGuardMigration).toContain("RAISE EXCEPTION 'stock_count_full_count_on_unclassified'")
  })
})
