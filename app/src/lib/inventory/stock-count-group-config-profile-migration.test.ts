import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  new URL('../../../../supabase/migrations/20260727_stock_count_group_config_profile.sql', import.meta.url),
  'utf8',
)

describe('group configuration profile migration', () => {
  it('adds an explicit, defaulted group profile column with a check constraint', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS stock_config_profile text')
    expect(migration).toContain("DEFAULT 'standard'")
    expect(migration).toContain("CHECK (stock_config_profile IN ('concentration', 'standard'))")
  })

  it('backfills concentration only for groups that genuinely used concentration configs', () => {
    expect(migration).toMatch(/UPDATE public\.product_groups[\s\S]*SET stock_config_profile = 'concentration'/)
    // Balance / movement / order reference are the data-driven signals.
    expect(migration).toContain('pi.quantity_on_hand <> 0')
    expect(migration).toContain('public.stock_movements sm')
    expect(migration).toContain('public.order_items oi')
  })

  it('installs a backend guard trigger rejecting concentration configs on standard groups', () => {
    expect(migration).toContain('assert_stock_config_group_eligibility')
    expect(migration).toContain('trg_stock_config_group_eligibility')
    expect(migration).toContain('BEFORE INSERT OR UPDATE')
    expect(migration).toMatch(/is not valid for a non-flavour product group/i)
  })

  it('only deactivates zero-balance, unreferenced invalid configs (never deletes)', () => {
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.inventory_stock_configurations/i)
    expect(migration).toContain("SET status = 'inactive'")
    expect(migration).toContain('NOT EXISTS (SELECT 1 FROM public.product_inventory pi')
    expect(migration).toContain('NOT EXISTS (SELECT 1 FROM public.stock_movements sm')
    expect(migration).toContain('NOT EXISTS (SELECT 1 FROM public.order_items oi')
  })

  it('documents the Unclassified -> Standard transfer without executing an inventory move', () => {
    expect(migration).toContain('DOCUMENTED ONLY')
    expect(migration).toContain('duplicating')
    expect(migration).toContain('device_unclassified_to_standard')
  })
})
