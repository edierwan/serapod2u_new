import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../../supabase/migrations/20260717_stock_config_07_reference_type_fix.sql', import.meta.url),
  'utf8',
)
const fulfilment = readFileSync(
  new URL('../../../../supabase/migrations/20260717_stock_config_05_so_fulfilment.sql', import.meta.url),
  'utf8',
)

describe('stock configuration migration 07 movement allowlists', () => {
  it('is a forward-only atomic constraint correction with no history rewrite', () => {
    expect(migration.startsWith('--')).toBe(true)
    expect(migration).toContain('BEGIN;')
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true)
    expect(migration).not.toMatch(/UPDATE\s+public\.stock_movements/i)
    expect(migration).not.toMatch(/UPDATE\s+public\.product_inventory/i)
  })

  it('preserves every migration 03 reference value and adds only Phase 4 references', () => {
    for (const value of ['manual', 'order', 'transfer', 'adjustment', 'purchase_order', 'return', 'campaign', 'repack']) {
      expect(migration).toContain(`'${value}'::text`)
    }
    expect(migration).toContain("'order_config_change'::text")
    expect(migration).toContain("'order_cancel_reversal'::text")
    expect(fulfilment).toContain("'order_config_change'")
    expect(fulfilment).toContain("'order_cancel_reversal'")
  })

  it('preserves signed movement validation and covers the active Spin Wheel flow', () => {
    for (const value of [
      'addition', 'transfer_in', 'order_cancelled', 'manual_in', 'scratch_game_in',
      'allocation', 'warranty_bonus', 'repack_in', 'transfer_out', 'order_fulfillment',
      'manual_out', 'scratch_game_out', 'deallocation', 'repack_out',
    ]) {
      expect(migration).toContain(`'${value}'::text`)
    }
    expect(migration).toContain("'spin_wheel_in'::text")
    expect(migration).toContain("'spin_wheel_out'::text")
    expect(migration).toContain('quantity_change > 0')
    expect(migration).toContain('quantity_change < 0')
    expect(migration).toContain("movement_type = 'adjustment'::text AND quantity_change <> 0")
  })

  it('keeps invalid references rejected through a closed CHECK allowlist', () => {
    expect(migration).toContain('ADD CONSTRAINT stock_movements_reference_type_check CHECK')
    expect(migration).toContain('reference_type = ANY (ARRAY[')
    expect(migration).not.toContain("'warehouse_receipt'::text")
    expect(migration).not.toContain("'unknown'::text")
  })

  it('keeps configuration changes and approved cancellation reversals exact and transactional', () => {
    expect(fulfilment).toContain('v_item.stock_config_id IS DISTINCT FROM p_stock_config_id')
    expect(fulfilment).toContain('quantity_allocated=quantity_allocated-v_item.qty')
    expect(fulfilment).toContain('quantity_allocated=quantity_allocated+v_item.qty')
    expect(fulfilment).toContain('stock_config_id=v_item.stock_config_id')
    expect(fulfilment).toContain('Buyer credit reversed on cancellation')
    expect(fulfilment).toContain('Exact configuration restored on cancellation')
    expect(fulfilment).not.toContain('EXCEPTION WHEN')
  })
})
