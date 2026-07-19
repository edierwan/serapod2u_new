import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), '../supabase/migrations/20260718_stock_config_12_transfer_dispatch_lifecycle.sql'),
  'utf8',
)

const fn = (name: string) => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = migration.indexOf('CREATE OR REPLACE FUNCTION public.', start + 1)
  return next > 0 ? migration.slice(start, next) : migration.slice(start)
}

describe('Phase 12 stock transfer dispatch lifecycle SQL', () => {
  it('adds ready_to_dispatch without dropping historical statuses', () => {
    expect(migration).toContain("'draft'::text")
    expect(migration).toContain("'pending'::text")
    expect(migration).toContain("'pending_approval'::text")
    expect(migration).toContain("'ready_to_dispatch'::text")
    expect(migration).toContain("'in_transit'::text")
    expect(migration).toContain("'received'::text")
    expect(migration).toContain("'cancelled'::text")
    expect(migration).toContain("'rejected'::text")
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS submitted_by')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS dispatched_by')
    expect(migration).toContain('\nBEGIN;\n')
    expect(migration.trim().endsWith('COMMIT;')).toBe(true)
  })

  it('submit reserves stock and records submitted_by without posting transfer_out', () => {
    const submit = fn('submit_stock_transfer_for_approval')
    const bodyEnd = submit.indexOf('$$;')
    const body = bodyEnd > 0 ? submit.slice(0, bodyEnd) : submit
    expect(body).toContain('_stock_transfer_reserve_items')
    expect(body).toContain("'pending_approval'")
    expect(body).toContain('submitted_by')
    expect(body).not.toContain("transfer_out")
    expect(body).not.toContain('record_stock_movement')
    expect(body).toContain('pg_advisory_xact_lock')
  })

  it('approve keeps reservation, does not post transfer_out, and lands on ready_to_dispatch', () => {
    const approve = fn('approve_stock_transfer')
    expect(approve).toContain('is_hq_admin()')
    expect(approve).toContain('Unauthorized approval')
    expect(approve).toContain('_stock_transfer_assert_reservation_integrity')
    expect(approve).toContain("'ready_to_dispatch'")
    expect(approve).not.toContain('_stock_transfer_release_reservations')
    expect(approve).not.toContain("p_movement_type := 'transfer_out'")
    expect(approve).not.toContain("p_movement_type := 'transfer_in'")
    expect(approve).toContain('pg_advisory_xact_lock')
  })

  it('dispatch consumes reservation and posts source transfer_out exactly once', () => {
    const dispatch = fn('dispatch_stock_transfer')
    expect(dispatch).toContain("'ready_to_dispatch'")
    expect(dispatch).toContain("'in_transit'")
    expect(dispatch).toContain('_stock_transfer_assert_reservation_integrity')
    expect(dispatch).toContain('_stock_transfer_release_reservations')
    expect(dispatch).toContain("p_movement_type := 'transfer_out'")
    expect(dispatch).toContain('Unauthorized dispatch')
    expect(dispatch).toContain('can_access_org(v_transfer.from_organization_id)')
    expect(dispatch).toContain('dispatched_by')
    expect(dispatch).toContain('shipped_at')
    expect(dispatch).toContain('pg_advisory_xact_lock')
    expect(dispatch).not.toContain("p_movement_type := 'transfer_in'")
  })

  it('receive posts destination transfer_in once and rejects ready_to_dispatch', () => {
    const receive = fn('receive_stock_transfer')
    expect(receive).toContain("p_movement_type := 'transfer_in'")
    expect(receive).toContain("status = 'received'")
    expect(receive).toContain('must be dispatched before it can be received')
    expect(receive).toContain('Only in-transit transfers can be received')
    expect(receive).toContain('Unauthorized receipt')
    expect(receive).toContain('can_access_org(v_transfer.to_organization_id)')
    expect(receive).toContain('Historical unclassified transfer lines cannot be received')
    expect(receive).toContain('pg_advisory_xact_lock')
  })

  it('cancel releases reservations for pending/ready and blocks in-transit cancel', () => {
    const cancel = fn('cancel_stock_transfer')
    const reject = fn('reject_stock_transfer')
    expect(cancel).toContain("'pending_approval', 'ready_to_dispatch'")
    expect(cancel).toContain('_stock_transfer_release_reservations')
    expect(cancel).toContain('In-transit transfers cannot be cancelled through the normal flow')
    expect(cancel).not.toContain('Transfer cancelled — source restored')
    expect(reject).toContain('_stock_transfer_release_reservations')
    expect(reject).toContain('is_hq_admin()')
  })

  it('reservation integrity locks inventory rows and rejects missing reservations', () => {
    const integrity = fn('_stock_transfer_assert_reservation_integrity')
    expect(integrity).toContain('FOR UPDATE')
    expect(integrity).toContain('Transfer reservation integrity failed')
    expect(integrity).toContain('quantity_allocated')
    expect(integrity).toContain('quantity_on_hand')
  })
})
