import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../../supabase/migrations/20260725_stock_count_classification_allocation_carry.sql', import.meta.url),
  'utf8',
)
const view = readFileSync(
  new URL('../../components/inventory/StockAdjustmentView.tsx', import.meta.url),
  'utf8',
)

describe('Initial physical count allocation carry SQL contract', () => {
  it('persists an explicit per-session target without changing historical drafts', () => {
    expect(migration).toContain('stock_count_classification_allocation_resolutions')
    expect(migration).toContain('primary key (session_id, variant_id)')
    expect(migration).toContain("sessions.status = 'draft'")
    expect(migration).not.toMatch(/insert into public\.stock_count_classification_allocation_resolutions[\\s\\S]*select/i)
  })

  it('allows physical variance but never guesses or silently releases an allocation', () => {
    expect(migration).toContain('stock_count_allocation_target_required')
    expect(migration).toContain('stock_count_allocation_owner_unresolved')
    expect(migration).toContain('target_stock_config_id')
    expect(migration).not.toContain('stock_count_classification_exceeds_legacy')
    expect(view).toContain('Reservation target configuration')
    expect(view).toContain('it is never silently released')
  })

  it('requires final target stock to cover existing and carried reservations', () => {
    expect(migration).toContain('v_target_physical < v_target_allocated + v_row.live_allocated')
    expect(migration).toContain('stock_count_allocation_target_insufficient')
    expect(migration).toContain('distributor_can_receive_stock_config')
  })

  it('reconciles allocation ownership to submitted order items before posting', () => {
    expect(migration).toContain("o.status = 'submitted'")
    expect(migration).toContain("o.order_type in ('D2H', 'S2D')")
    expect(migration).toContain('public.order_inventory_organization(o.id) = p_warehouse_id')
    expect(migration).toContain("sm.movement_type = 'allocation'")
    expect(migration).toContain("sm.movement_type in ('deallocation', 'order_fulfillment')")
  })

  it('posts targets, carries reservations, then clears Legacy in one transaction', () => {
    const targetPost = migration.indexOf('Establish every target final physical balance first')
    const carry = migration.indexOf('stock_count_carry_classification_allocations(', targetPost)
    const legacyClear = migration.indexOf('Legacy can now safely reach zero', carry)
    expect(targetPost).toBeGreaterThan(-1)
    expect(carry).toBeGreaterThan(targetPost)
    expect(legacyClear).toBeGreaterThan(carry)
    expect(migration.trimEnd().endsWith('commit;')).toBe(true)
  })

  it('updates order identity and writes paired reservation audit movements', () => {
    expect(migration).toContain("'deallocation', 'order_config_change'")
    expect(migration).toContain("'allocation', 'order_config_change'")
    expect(migration).toContain('stock_config_confirmed_at = now()')
    expect(migration).toContain('allocation_movement_count')
  })

  it('binds live allocations and the selected target into the OTP snapshot', () => {
    expect(migration).toContain("'current_allocated_quantity'")
    expect(migration).toContain("'allocation_resolutions'")
    expect(migration).toContain("'target_stock_config_id'")
    expect(migration).toContain('stock_count_snapshot_changed')
  })

  it('keeps posting single-use and idempotent', () => {
    expect(migration).toContain("v_session.status = 'posted'")
    expect(migration).toContain("v_request.status = 'posted' or v_request.consumed_at is not null")
    expect(migration).toContain("where id = v_session.id and status = 'draft'")
    expect(migration).toContain('consumed_at = now()')
  })
})
