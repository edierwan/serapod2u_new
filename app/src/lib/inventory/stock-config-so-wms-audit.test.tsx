import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')
const migration = repoFile('supabase/migrations/20260717_stock_config_05_so_fulfilment.sql')
const confirmShipment = repoFile('app/src/app/api/warehouse/confirm-shipment/route.ts')

describe('SO and WMS stock-configuration safety contract', () => {
  it('persists and confirms one exact configuration per order line', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS stock_config_id uuid')
    expect(migration).toContain('stock_config_confirmed_at')
    expect(migration).toContain('set_order_item_stock_config')
    expect(migration).toContain("packaging IS DISTINCT FROM 'old_box'")
  })

  it('resolves QR inventory through order_item_id without a default fallback', () => {
    const wms = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.wms_from_unique_codes'))
    expect(wms).toContain('oi.id=qc.order_item_id')
    expect(wms).toContain('oi.stock_config_confirmed_at IS NOT NULL')
    expect(wms).not.toContain('resolve_default_stock_config')
  })

  it('fails closed instead of auto-creating shipment inventory', () => {
    expect(confirmShipment).not.toContain("rpc('adjust_inventory_quantity'")
    expect(confirmShipment).toContain('WMS rejected master')
  })

  it('includes configuration identity in WMS and outbound deduplication', () => {
    expect(migration).toContain("concat_ws('|',v_variant,v_cfg")
    expect(migration).toContain('m.stock_config_id=NEW.stock_config_id')
  })
})
