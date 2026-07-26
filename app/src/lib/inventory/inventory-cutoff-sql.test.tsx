import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../../supabase/migrations/20260726_inventory_opening_balance_cutoff/', import.meta.url)
const sql = (name: string) => fs.readFileSync(new URL(name, root), 'utf8')
const foundation = sql('01_cutoff_foundation.sql')
const preview = sql('02_cutoff_preview_and_decisions.sql')
const posting = sql('03_cutoff_atomic_posting.sql')

describe('Inventory Opening Balance Cut-off SQL contract', () => {
  it('uses the existing Stock Count tables and applies a warehouse-scoped freeze', () => {
    expect(foundation).toContain("'opening_balance_cutoff'")
    expect(foundation).toContain('inventory_cutoff_product_inventory_guard')
    expect(foundation).toContain('inventory_cutoff_stock_movement_guard')
    expect(foundation).toContain('warehouse_organization_id = p_warehouse_id')
    expect(foundation).toContain('inventory_cutoff_is_hq_admin')
  })

  it('keeps preview read-only and classifies exact lifecycle statuses', () => {
    const body = preview.slice(preview.indexOf('create or replace function public.inventory_cutoff_preview'))
    expect(body).not.toMatch(/\b(update|delete|insert into)\s+public\./i)
    expect(body).toContain("o.status='submitted'")
    expect(body).toContain("'approved','warehouse_packed','shipped_distributor'")
    expect(body).toContain("'approved','closed'")
    expect(body).toContain('Protected — No Impact')
  })

  it('cancels submitted distributor orders through release_allocation_for_order', () => {
    expect(posting).toContain("v_order.status<>'submitted'")
    expect(posting).toContain("status='cancelled'")
    expect(posting).toContain('release_allocation_for_order(v_order.id)')
    expect(posting).toContain('Cancelled during Inventory Opening Balance Cut-off')
  })

  it('maps carried distributor allocations only to active 20ml New Box', () => {
    expect(preview).toContain("c.volume_ml=20 and c.packaging='new_box'")
    expect(posting).toContain("c.volume_ml=20 and c.packaging='new_box'")
    expect(posting).toContain('inventory_cutoff_carried_allocation_shortage')
  })

  it('preserves partial H2M receiving and the selected item configuration', () => {
    expect(posting).toContain("v_order.order_type<>'H2M'")
    expect(posting).toContain('sum(received_now)')
    expect(posting).toContain('p_quantity_change=>v_received')
    expect(posting).toContain('p_stock_config_id=>v_config')
    expect(posting).toContain('warehouse_receipt_order_item_configuration_missing_or_conflicting')
  })

  it('does not mutate or reclassify QR records', () => {
    const dml = `${foundation}\n${preview}\n${posting}`.match(
      /\b(?:insert\s+into|update|delete\s+from|truncate\s+(?:table\s+)?)\s+public\.(qr_[a-z0-9_]+|consumer_qr_scans|qr_verification_log)\b/gi,
    )
    expect(dml).toBeNull()
  })

  it('rechecks readiness and consumes OTP atomically and idempotently', () => {
    expect(posting).toContain('for update')
    expect(posting).toContain('inventory_cutoff_preview(v_cutoff.id)')
    expect(posting).toContain("v_request.status='posted'")
    expect(posting).toContain("where id=v_session.id and status='draft'")
    expect(posting).toContain("where id=v_cutoff.id and status='counting'")
  })
})
