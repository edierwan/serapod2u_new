import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../../../../supabase/migrations/20260726_inventory_opening_balance_cutoff/', import.meta.url)
const sql = (name: string) => fs.readFileSync(new URL(name, root), 'utf8')
const foundation = sql('01_cutoff_foundation.sql')
const preview = sql('02_cutoff_preview_and_decisions.sql')
const posting = sql('03_cutoff_atomic_posting.sql')
const soLifecycle = fs.readFileSync(
  new URL('../../../../supabase/migrations/20260717_stock_config_05_so_fulfilment.sql', import.meta.url),
  'utf8',
)
const confirmShipment = fs.readFileSync(
  new URL('../../app/api/warehouse/confirm-shipment/route.ts', import.meta.url),
  'utf8',
)
const verificationRequest = fs.readFileSync(
  new URL('../../app/api/inventory/stock-count/verification/request/route.ts', import.meta.url),
  'utf8',
)

describe('Inventory Opening Balance Cut-off SQL contract', () => {
  it('uses the existing Stock Count tables and applies a warehouse-scoped freeze', () => {
    expect(foundation).toContain("'opening_balance_cutoff'")
    expect(foundation).toContain('inventory_cutoff_product_inventory_guard')
    expect(foundation).toContain('inventory_cutoff_stock_movement_guard')
    expect(foundation).toContain('warehouse_organization_id = p_warehouse_id')
    expect(foundation).toContain('inventory_cutoff_is_hq_admin')
  })

  it('keeps preview read-only and classifies exact lifecycle statuses', () => {
    const body = preview.match(
      /create or replace function public\.inventory_cutoff_preview[\s\S]*?\n\$\$;/i,
    )?.[0] || ''
    expect(body).not.toMatch(/\b(update|delete|insert into)\s+public\./i)
    expect(body).toContain("o.status='submitted'")
    expect(body).toContain("o.status in ('approved','warehouse_packed')")
    expect(body).toContain("o.status='shipped_distributor'")
    expect(body).toContain("'approved','closed'")
    expect(body).toContain('Protected — No Impact')
  })

  it('classifies only actual confirmed shipment as Stock in Transit', () => {
    expect(soLifecycle).toContain("PERFORM public.fulfill_order_inventory(p_order_id)")
    expect(soLifecycle).toContain("UPDATE public.orders SET status='approved'")
    expect(soLifecycle).toContain('quantity_on_hand=quantity_on_hand-v_item.qty')
    expect(confirmShipment).toContain("status: 'shipped_distributor'")
    expect(confirmShipment).toContain(".eq('status', 'warehouse_packed')")
    expect(preview).toContain("when o.status in ('approved','warehouse_packed') then 'Complete Before Cut-off'")
    expect(preview).toContain("when o.status='shipped_distributor' then 'Stock in Transit'")
  })

  it('leaves the normal post-cut-off order lifecycle authoritative and idempotent', () => {
    expect(`${foundation}\n${preview}\n${posting}`).not.toContain(
      'create or replace function public.allocate_inventory_for_order',
    )
    expect(`${foundation}\n${preview}\n${posting}`).not.toContain(
      'create or replace function public.orders_approve',
    )
    expect(soLifecycle).toContain("movement_type='order_fulfillment') THEN CONTINUE")
    expect(soLifecycle).toContain("IF v.status<>'submitted'")
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
    expect(posting).toContain('warehouse_receipt_order_already_fully_received')
    expect(posting).toContain("d.decision='history_only'")
    expect(posting).toContain("status='cancelled'")
  })

  it('uses a protected transaction context rather than a client-settable GUC for freeze bypass', () => {
    expect(foundation).toContain('inventory_cutoff_posting_context')
    expect(foundation).toMatch(
      /inventory_cutoff_assert_not_frozen\(p_warehouse_id uuid\)\s+returns void language plpgsql volatile/i,
    )
    expect(foundation).toContain('ctx.backend_pid=pg_backend_pid()')
    expect(foundation).toContain('ctx.transaction_id=txid_current()')
    expect(foundation).toContain('revoke all on public.inventory_cutoff_posting_context')
    expect(`${foundation}\n${posting}`).not.toContain("set_config('app.inventory_cutoff_bypass'")
    expect(posting).toContain('insert into public.inventory_cutoff_posting_context')
    expect(posting).toContain('delete from public.inventory_cutoff_posting_context')
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
    expect(preview).toContain('inventory_cutoff_snapshot_hash')
    expect(preview).toContain("'inventory_cutoff_decision_changed'")
    expect(verificationRequest).toContain('bind_inventory_cutoff_verification_snapshot')
    expect(posting).toContain('inventory_cutoff_snapshot_hash(v_cutoff.id)')
    expect(posting).toContain("v_request.status='posted'")
    expect(posting).toContain("where id=v_session.id and status='draft'")
    expect(posting).toContain("where id=v_cutoff.id and status='counting'")
  })

  it('keeps the established service-role warehouse receipt call compatible', () => {
    expect(posting).toContain("coalesce(auth.role(),'')<>'service_role'")
    expect(posting).toContain('p_received_by is distinct from auth.uid()')
    expect(posting).toContain('warehouse_receipt_order_already_fully_received')
  })
})
