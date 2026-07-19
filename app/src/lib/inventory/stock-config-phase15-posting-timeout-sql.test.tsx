import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260719_stock_config_15_posting_statement_timeout.sql'),
  'utf8',
)

describe('Phase 15 posting statement_timeout SQL contract', () => {
  it('raises statement_timeout on both Stock Count posting RPCs (fixes 8s authenticated-role cancel)', () => {
    expect(migration).toContain(
      "ALTER FUNCTION public.verify_and_post_stock_classification(uuid, text)\n  SET statement_timeout TO '300s';",
    )
    expect(migration).toContain(
      "ALTER FUNCTION public.verify_and_post_stock_count(uuid, text)\n  SET statement_timeout TO '300s';",
    )
  })

  it('raises lock_timeout on both posting RPCs so contended row locks do not abort at 8s', () => {
    expect(migration).toContain(
      "ALTER FUNCTION public.verify_and_post_stock_classification(uuid, text)\n  SET lock_timeout TO '30s';",
    )
    expect(migration).toContain(
      "ALTER FUNCTION public.verify_and_post_stock_count(uuid, text)\n  SET lock_timeout TO '30s';",
    )
  })

  it('reloads the PostgREST schema cache and documents idempotency is preserved', () => {
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';")
    expect(migration).toMatch(/idempoten|posts exactly once|single-use/i)
  })

  it('bounds the timeout instead of disabling it, so a stuck post cannot hold locks forever', () => {
    expect(migration).not.toContain("statement_timeout TO '0'")
    expect(migration).not.toContain('statement_timeout TO 0')
  })
})
