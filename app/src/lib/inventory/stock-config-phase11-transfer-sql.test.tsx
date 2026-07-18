import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260718_stock_config_11_transfer_workflow.sql'),
  'utf8',
)

const fn = (name: string) => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  expect(start).toBeGreaterThan(0)
  const next = migration.indexOf('CREATE OR REPLACE FUNCTION public.', start + 1)
  return next > 0 ? migration.slice(start, next) : migration.slice(start)
}

describe('Phase 11 stock transfer workflow SQL', () => {
  it('extends status lifecycle without dropping historical pending/in_transit/received/cancelled', () => {
    expect(migration).toContain("'draft'::text")
    expect(migration).toContain("'pending_approval'::text")
    expect(migration).toContain("'pending'::text")
    expect(migration).toContain("'in_transit'::text")
    expect(migration).toContain("'received'::text")
    expect(migration).toContain("'cancelled'::text")
    expect(migration).toContain("'rejected'::text")
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS required_date')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS submitted_at')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS approved_at')
  })

  it('draft save performs no reservation and no ledger movement', () => {
    const body = fn('save_stock_transfer_draft')
    expect(body).toContain("'draft'")
    expect(body).not.toContain('record_stock_movement')
    expect(body).not.toContain('quantity_allocated')
    expect(body).toContain('_stock_transfer_normalize_items')
  })

  it('submit reserves available stock and approve posts source transfer_out once after revalidation', () => {
    const submit = fn('submit_stock_transfer_for_approval')
    const approve = fn('approve_stock_transfer')
    expect(submit).toContain('_stock_transfer_reserve_items')
    expect(submit).toContain("'pending_approval'")
    expect(submit).not.toContain("transfer_out")
    expect(approve).toContain('is_hq_admin()')
    expect(approve).toContain('Unauthorized approval')
    expect(approve).toContain('_stock_transfer_release_reservations')
    expect(approve).toContain("p_movement_type := 'transfer_out'")
    expect(approve).toContain('Insufficient available stock at approval')
    expect(approve).toContain('pg_advisory_xact_lock')
    expect(approve).not.toContain("p_movement_type := 'transfer_in'")
  })

  it('receive posts destination transfer_in once and is idempotent for historical destination posts', () => {
    const receive = fn('receive_stock_transfer')
    expect(receive).toContain("p_movement_type := 'transfer_in'")
    expect(receive).toContain("status = 'received'")
    expect(receive).toContain('v_in_count >= v_expected')
    expect(receive).toContain('pg_advisory_xact_lock')
    expect(receive).toContain('Historical unclassified transfer lines cannot be received')
  })

  it('reject/cancel release reservations and in-transit cancel restores source without double destination post', () => {
    const reject = fn('reject_stock_transfer')
    const cancel = fn('cancel_stock_transfer')
    expect(reject).toContain('_stock_transfer_release_reservations')
    expect(reject).toContain('is_hq_admin()')
    expect(cancel).toContain('_stock_transfer_release_reservations')
    expect(cancel).toContain('Transfer cancelled — source restored')
    expect(cancel).toContain('Cannot cancel a transfer after destination stock has been posted')
  })

  it('normalizes exact stock_config_id identity and rejects legacy/unclassified and non-positive quantities', () => {
    const normalize = fn('_stock_transfer_normalize_items')
    expect(normalize).toContain('stock_config_id')
    expect(normalize).toContain("config_code = 'UNCLASSIFIED'")
    expect(normalize).toContain('Legacy/Unclassified stock cannot be transferred')
    expect(normalize).toContain('positive whole numbers')
    expect(normalize).toContain('v_qty <> trunc(v_qty)')
    expect(normalize).toContain('Only active stock configurations')
  })

  it('keeps the legacy immediate dual-post RPC untouched and wraps work in one transaction', () => {
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.post_stock_transfer_configured')
    expect(migration).toContain('\nBEGIN;\n')
    expect(migration.trim().endsWith('COMMIT;')).toBe(true)
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'")
  })
})
