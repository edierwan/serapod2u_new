import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = (name: string) => readFileSync(new URL(`../../../../supabase/migrations/${name}`, import.meta.url), 'utf8')
const groundwork = migration('20260717_stock_config_01_groundwork.sql')
const repack = migration('20260717_stock_config_03_ord_repack.sql')
const stockCount = migration('20260717_stock_config_04_stock_count.sql')
const fulfilment = migration('20260717_stock_config_05_so_fulfilment.sql')
const reports = migration('20260717_stock_config_06_views_reports.sql')

describe('stock configuration end-to-end migration contract', () => {
  it('routes ORD receiving to the configured ORD default without classifying old stock', () => {
    expect(groundwork).toContain('default_for_ord')
    expect(groundwork).toContain('existing balances are intentionally NOT guessed')
    expect(repack).toContain('AND c.default_for_ord')
  })

  it('selects 20NB normally and permits 50NB only through distributor eligibility', () => {
    expect(fulfilment).toContain("WHEN c.volume_ml=20 AND c.packaging='new_box' THEN 0")
    expect(fulfilment).toContain('allow_50ml_new_box')
    expect(fulfilment).toContain('distributor_can_receive_stock_config')
  })

  it('blocks old box and keeps one configuration on each SO line', () => {
    expect(fulfilment).toContain("c.packaging IS DISTINCT FROM 'old_box'")
    expect(fulfilment).toContain('order_items_stock_config_variant_fkey')
    expect(fulfilment).toContain('stock_config_confirmed_at')
  })

  it('allocates, fulfils, credits and reverses the exact same configuration', () => {
    expect(fulfilment).toContain('quantity_allocated=quantity_allocated+v_item.qty')
    expect(fulfilment).toContain('Buyer inventory credited from confirmed configuration')
    expect(fulfilment).toContain('Buyer credit reversed on cancellation')
    expect(fulfilment).toContain('Exact configuration restored on cancellation')
  })

  it('makes QR configuration resolution order-line-only and idempotent', () => {
    const wms = fulfilment.slice(fulfilment.indexOf('CREATE OR REPLACE FUNCTION public.wms_from_unique_codes'))
    expect(wms).toContain('oi.id=qc.order_item_id')
    expect(wms).not.toContain('resolve_default_stock_config')
    expect(fulfilment).toContain('inventory_already_posted')
    expect(fulfilment).toContain('wms_movement_dedup')
  })

  it('supports old-box to new-box repacking and three-configuration counts', () => {
    expect(repack).toContain("packaging IS DISTINCT FROM 'old_box'")
    expect(repack).toContain("packaging IS DISTINCT FROM 'new_box'")
    expect(stockCount).toContain('stock_config_id')
    expect(stockCount).toContain('stock_count_session_items_unique_config')
  })

  it('preserves unrelated STD flows and legacy movement visibility', () => {
    expect(groundwork).toContain("'STD'")
    expect(reports).toContain('(sm.stock_config_id IS NULL) AS is_legacy_configuration')
    expect(reports).toContain("c.status='active' OR pi.quantity_on_hand<>0 OR pi.quantity_allocated<>0")
  })

  it('aggregates variant totals only after configuration balances', () => {
    expect(reports).toContain('SUM(pi.quantity_on_hand)')
    expect(reports).toContain('COUNT DISTINCT variants prevent double counting')
    expect(reports).toContain('GROUP BY pi.organization_id,pi.variant_id')
  })

  it('keeps multi-step inventory functions transactional and fail-closed', () => {
    expect(fulfilment.startsWith('-- Inventory')).toBe(true)
    expect(fulfilment).toContain('BEGIN;')
    expect(fulfilment.trimEnd().endsWith('COMMIT;')).toBe(true)
    expect(fulfilment).toContain("RAISE EXCEPTION 'Every QR code must resolve to a confirmed order item configuration'")
    const transfer = reports.slice(reports.indexOf('CREATE OR REPLACE FUNCTION public.post_stock_transfer_configured'))
    expect(transfer).toContain("p_movement_type:='transfer_out'")
    expect(transfer).toContain("p_movement_type:='transfer_in'")
    expect(transfer).toContain("RAISE EXCEPTION 'Invalid variant/configuration transfer line'")
  })
})
