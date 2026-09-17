import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) =>
  fs.readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')

const MIGRATION = '20260917120000_order_cancelled_movement_warehouse_anchor.sql'
const migration = repoFile(`supabase/migrations/${MIGRATION}`)
const previousResolver = repoFile('supabase/migrations/20260717_stock_config_03_ord_repack.sql')
// Current bodies of the balance trigger and the fulfilled-order reversal.
const balanceTrigger = repoFile('supabase/migrations/20260904100000_canonical_operational_stock_config.sql')
const releaseMigration = repoFile(
  'supabase/migrations/20260801210000_fix_d2h_cancel_null_config_movement_variant_default.sql',
)

const resolverBody = (sql: string) =>
  sql.match(/create or replace function public\._movement_warehouse_id[\s\S]*?\$\$;/i)?.[0] ?? ''

const typeList = (body: string, target: 'p_from' | 'p_to') => {
  const list = body.match(new RegExp(`WHEN p_movement_type IN \\(([^)]*)\\) THEN ${target}`))?.[1] ?? ''
  return list.split(',').map((t) => t.trim().replace(/'/g, '')).filter(Boolean)
}

// Executable model of public._movement_warehouse_id, built from the SQL text.
const resolverFrom = (sql: string) => {
  const body = resolverBody(sql)
  const outbound = typeList(body, 'p_from')
  const inbound = typeList(body, 'p_to')
  expect(body).toContain('ELSE COALESCE(p_from, p_to)')
  return (type: string, from: string | null, to: string | null) =>
    outbound.includes(type) ? from : inbound.includes(type) ? to : (from ?? to)
}

const fixedResolver = resolverFrom(migration)
const priorResolver = resolverFrom(previousResolver)

// Model of the "both balance fields supplied" branch of
// trg_stock_movements_fill_cost_and_balance (asserted against the SQL below).
type Movement = { type: string; from: string; to: string; change: number; before: number; after: number }
const anchorError = (
  resolve: typeof fixedResolver,
  onHand: Record<string, number>,
  m: Movement,
) => {
  if (m.type === 'allocation' || m.type === 'deallocation') return null
  const current = onHand[resolve(m.type, m.from, m.to) ?? ''] ?? 0
  if (m.after === m.before + m.change && (current === m.before || current === m.after)) return null
  return `Movement balance is not anchored to current inventory. Current ${current}, before ${m.before}, change ${m.change}, after ${m.after}`
}

// Production incident: buyer holds 102 (2 + 100 fulfilled), warehouse 1200.
// release_allocation_for_order updates both rows first (buyer 2, warehouse
// 1300) and then inserts the two reversal legs, both buyer -> warehouse.
const BUYER = 'buyer'
const WAREHOUSE = 'warehouse'
const afterInventoryUpdate = { [BUYER]: 2, [WAREHOUSE]: 1300 }
const reversal: Movement[] = [
  { type: 'transfer_out', from: BUYER, to: WAREHOUSE, change: -100, before: 102, after: 2 },
  { type: 'order_cancelled', from: BUYER, to: WAREHOUSE, change: 100, before: 1200, after: 1300 },
]

describe('order_cancelled balance anchor (forward migration)', () => {
  it('is a forward-only, transaction-wrapped CREATE OR REPLACE', () => {
    expect(migration.trim().toLowerCase()).toMatch(/^--[\s\S]*\nbegin;/)
    expect(migration.trim().toLowerCase()).toMatch(/commit;$/)
    expect(migration).toMatch(/create or replace function public\._movement_warehouse_id\(p_movement_type text, p_from uuid, p_to uuid\)/i)
    expect(migration).toMatch(/language sql immutable/i)
  })

  it('never writes inventory, movements, orders or QR data', () => {
    expect(migration).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i)
  })

  it('resolves order_cancelled to p_to', () => {
    expect(fixedResolver('order_cancelled', BUYER, WAREHOUSE)).toBe(WAREHOUSE)
    // Prior definition fell into COALESCE(p_from, p_to) and picked the buyer.
    expect(priorResolver('order_cancelled', BUYER, WAREHOUSE)).toBe(BUYER)
  })

  it('keeps transfer_out on p_from and every other mapping unchanged', () => {
    expect(fixedResolver('transfer_out', BUYER, WAREHOUSE)).toBe(BUYER)
    const prior = resolverBody(previousResolver)
    const fixed = resolverBody(migration)
    expect(typeList(fixed, 'p_from')).toEqual(typeList(prior, 'p_from'))
    expect(typeList(fixed, 'p_to')).toEqual([...typeList(prior, 'p_to'), 'order_cancelled'])
    for (const type of ['transfer_in', 'order_fulfillment', 'allocation', 'deallocation', 'qr_ship', 'warehouse_receive', 'adjustment']) {
      expect(fixedResolver(type, 'a', 'b')).toBe(priorResolver(type, 'a', 'b'))
      expect(fixedResolver(type, 'a', null)).toBe(priorResolver(type, 'a', null))
      expect(fixedResolver(type, null, 'b')).toBe(priorResolver(type, null, 'b'))
    }
  })

  it('reversal legs move buyer 102 -> 2 and warehouse 1200 -> 1300 without an anchor mismatch', () => {
    const [out, cancelled] = reversal
    expect(out.after).toBe(out.before + out.change)
    expect(cancelled.after).toBe(cancelled.before + cancelled.change)
    expect(fixedResolver(out.type, out.from, out.to)).toBe(BUYER)
    expect(fixedResolver(cancelled.type, cancelled.from, cancelled.to)).toBe(WAREHOUSE)
    for (const m of reversal) expect(anchorError(fixedResolver, afterInventoryUpdate, m)).toBeNull()
  })

  it('reproduces the production error with the prior mapping', () => {
    expect(anchorError(priorResolver, afterInventoryUpdate, reversal[0])).toBeNull()
    expect(anchorError(priorResolver, afterInventoryUpdate, reversal[1])).toBe(
      'Movement balance is not anchored to current inventory. Current 2, before 1200, change 100, after 1300',
    )
  })

  it('leaves allocation/deallocation outside the on-hand anchor', () => {
    const dealloc: Movement = { type: 'deallocation', from: BUYER, to: WAREHOUSE, change: -100, before: 100, after: 0 }
    expect(anchorError(fixedResolver, afterInventoryUpdate, dealloc)).toBeNull()
    expect(balanceTrigger).toMatch(
      /IF NEW\.movement_type IN \('allocation', 'deallocation'\) THEN[\s\S]*?RETURN NEW;\s*END IF;\s*IF v_wh_id IS NULL THEN/,
    )
  })

  it('matches the SQL the model stands in for', () => {
    // Balance trigger anchors through the shared resolver on the locked row.
    expect(balanceTrigger).toContain('v_wh_id := public._movement_warehouse_id(')
    expect(balanceTrigger).toContain('AND organization_id = v_wh_id')
    expect(balanceTrigger).toContain('AND (v_current_qty = NEW.quantity_before OR v_current_qty = NEW.quantity_after) THEN')
    expect(balanceTrigger).toContain("RAISE EXCEPTION 'Movement balance is not anchored to current inventory. Current %, before %, change %, after %'")
    // Reversal: inventory updated first, then both legs buyer -> warehouse.
    const release = releaseMigration.match(/create or replace function public\.release_allocation_for_order[\s\S]*?\$\$;/i)?.[0] ?? ''
    const legs = release.match(/VALUES\('transfer_out','order_cancel_reversal'[\s\S]*?'Exact configuration restored on cancellation'\)/)?.[0] ?? ''
    expect(release.indexOf('quantity_on_hand=quantity_on_hand+v_item.qty')).toBeLessThan(release.indexOf(legs))
    expect(legs).toContain('v_order.buyer_org_id,v_org,-v_item.qty,v_buyer_on,v_buyer_on-v_item.qty')
    expect(legs).toContain("('order_cancelled','order_cancel_reversal'")
    expect(legs).toContain('v_order.buyer_org_id,v_org,v_item.qty,v_wh_on,v_wh_on+v_item.qty')
  })

  it('rebuilds the expression index keyed on the resolver, only where it exists', () => {
    expect(migration).toContain("to_regclass('public.idx_stock_movements_wh_variant_time') is not null")
    expect(migration).toContain("execute 'reindex index public.idx_stock_movements_wh_variant_time'")
    expect(migration.indexOf('reindex index')).toBeGreaterThan(migration.search(/create or replace function/i))
  })
})
