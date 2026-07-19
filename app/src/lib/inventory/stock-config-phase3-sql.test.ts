import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260717_stock_config_04_stock_count.sql'),
  'utf8',
)

describe('Phase 3 Stock Count SQL contract', () => {
  it('keys new draft uniqueness by configuration without backfilling legacy identities', () => {
    expect(migration).toContain('stock_count_session_items_unique_config')
    expect(migration).toContain('(session_id, stock_config_id)')
    expect(migration).toContain('WHERE stock_config_id IS NOT NULL')
    expect(migration).not.toMatch(/UPDATE\s+public\.stock_count_session_items\s+SET\s+stock_config_id/i)
    expect(migration).not.toMatch(/UPDATE\s+public\.stock_adjustment_items\s+SET\s+stock_config_id/i)
  })

  it('rejects missing identities and snapshots exact configuration balances', () => {
    expect(migration).toContain("RAISE EXCEPTION 'stock_count_config_identity_missing'")
    expect(migration).toMatch(/pi\.stock_config_id\s*=\s*i\.stock_config_id/g)
    expect(migration).toContain("'stock_config_id', i.stock_config_id")
  })

  it('locks counted configuration balances before snapshot verification', () => {
    const advisoryLock = migration.indexOf('pg_advisory_xact_lock')
    const rowLock = migration.indexOf('FOR UPDATE OF pi', advisoryLock)
    const snapshotCheck = migration.indexOf('v_current_snapshot :=', rowLock)
    expect(advisoryLock).toBeGreaterThan(0)
    expect(rowLock).toBeGreaterThan(advisoryLock)
    expect(snapshotCheck).toBeGreaterThan(rowLock)
    expect(migration.slice(advisoryLock, snapshotCheck)).toContain('i.physical_quantity IS NOT NULL')
  })

  it('passes configuration identity to both movement and adjustment audit rows', () => {
    expect(migration).toContain('p_stock_config_id => v_item.stock_config_id')
    expect(migration).toMatch(/INSERT INTO public\.stock_adjustment_items \([\s\S]*?stock_config_id/)
    expect(migration).toMatch(/SELECT v_adjustment_id, variant_id, stock_config_id/)
  })
})
