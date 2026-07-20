import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  path.resolve(__dirname, '../../../../supabase/migrations/20260720_hq_warehouse_fulfillment_01.sql'),
  'utf8',
)

describe('HQ warehouse fulfillment migration contract', () => {
  it('adds nullable fulfillment_warehouse_id with FK and index', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS fulfillment_warehouse_id uuid')
    expect(migration).toContain('orders_fulfillment_warehouse_id_fkey')
    expect(migration).toContain('idx_orders_fulfillment_warehouse_id')
    expect(migration).not.toContain('UPDATE public.orders SET fulfillment_warehouse_id')
  })

  it('reuses organizations.default_warehouse_org_id as the default setting', () => {
    expect(migration).toContain('default_distributor_fulfillment_warehouse_id')
    expect(migration).toContain('organizations.default_warehouse_org_id')
  })

  it('resolves inventory org with fulfillment warehouse first and legacy movement fallback', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.order_inventory_organization')
    expect(migration).toContain('o.fulfillment_warehouse_id')
    expect(migration).toContain("sm.movement_type IN ('allocation', 'order_fulfillment')")
  })

  it('provides atomic submit/allocate with idempotency and warehouse immutability', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.submit_and_allocate_d2h_order')
    expect(migration).toContain('d2h_order_submit_idempotency')
    expect(migration).toContain('orders_fulfillment_warehouse_guard')
    expect(migration).toContain('Fulfillment warehouse cannot be changed after the order leaves Draft')
    expect(migration).toContain('Insufficient available stock at %')
  })
})
