import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  path.resolve(__dirname, '../../../../supabase/migrations/20260720_hq_warehouse_return_posting_03.sql'),
  'utf8',
)
const skipExcludedMigration = readFileSync(
  path.resolve(
    __dirname,
    '../../../../supabase/migrations/20260904120000_return_inventory_skip_historically_excluded.sql',
  ),
  'utf8',
)
const statusRoute = readFileSync(
  path.resolve(__dirname, '../../app/api/returns/[id]/status/route.ts'),
  'utf8',
)

describe('Return Product warehouse posting contract', () => {
  it('posts only through post_return_case_inventory with return reference metadata', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.post_return_case_inventory')
    expect(migration).toContain("p_reference_type := 'return'")
    expect(migration).toContain('p_organization_id := v_case.return_warehouse_id')
    expect(migration).toContain('Return inventory can only be posted at/after Return Received')
  })

  it('locks destination warehouse after receipt and wires status advance to posting', () => {
    expect(migration).toContain('Return warehouse cannot be changed after inventory receipt/posting has started')
    expect(statusRoute).toContain("next === 'return_received'")
    expect(statusRoute).toContain('post_return_case_inventory')
  })

  it('skips inventory for returns historically excluded by a posted Opening Balance', () => {
    expect(skipExcludedMigration).toContain('historically_excluded')
    expect(skipExcludedMigration).toContain('inventory_cutoff_excluded_transactions')
    expect(skipExcludedMigration).toContain("x.transaction_type = 'return'")
    expect(skipExcludedMigration).toContain("c.status = 'posted'")
    expect(skipExcludedMigration).toMatch(/posted_lines',\s*0/)
    expect(skipExcludedMigration.toLowerCase()).toContain("notify pgrst, 'reload schema'")
    expect(statusRoute).toContain('historically_excluded')
  })
})
