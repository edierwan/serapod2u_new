import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrations = path.resolve(__dirname, '../../../../supabase/migrations')
const NAME = '20260915130000_warehouse_receipt_config_resolution.sql'
const sql = readFileSync(path.join(migrations, NAME), 'utf-8')
const installed = readFileSync(path.join(migrations, '20260726_inventory_opening_balance_cutoff/03_cutoff_atomic_posting.sql'), 'utf-8')

const fnBody = (text: string) => text.slice(
  text.indexOf('create or replace function public.post_warehouse_receipt('),
  text.indexOf(') to authenticated;', text.indexOf('create or replace function public.post_warehouse_receipt(')),
)
const next = fnBody(sql)
const prev = fnBody(installed)
const executable = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

describe('post_warehouse_receipt destination resolution — SQL', () => {
  it('changes no schema: only the function, its grants and comment', () => {
    expect(executable).not.toMatch(/\b(alter\s+table|create\s+table|create\s+index|add\s+column|drop\s+|create\s+type|insert\s+into\s+public\.inventory_stock_configurations|update\s+public\.order_items)\b/i)
    expect(executable.match(/create or replace function/gi)).toHaveLength(1)
    expect(executable).toMatch(/^begin;/m)
    expect(executable).toMatch(/^commit;/m)
  })

  it('keeps the signature, grants and everything outside the resolution block byte-identical', () => {
    const outside = (body: string, startMarker: string, endMarker: string) => {
      const start = body.indexOf(startMarker)
      const end = body.indexOf(endMarker, start)
      return body.slice(0, start) + body.slice(end)
    }
    const END = "    select coalesce(sum(qty),0)::integer,coalesce(max(unit_price),0)"
    const normalize = (s: string) => s
      .replace("  v_config_source text;\n  v_order_item_rows integer;\n", '')
      .replace(",'stock_config_source',v_config_source", '')
    expect(normalize(outside(next, '    -- Inventory destination (stock configuration)', END)))
      .toBe(outside(prev, '    select min(oi.stock_config_id::text)::uuid,count(distinct oi.stock_config_id)', END))
  })

  it('resolves explicit → previous receipt → canonical, in that order', () => {
    const explicit = next.indexOf("v_config_source:='order_item'")
    const previous = next.indexOf("v_config_source:='previous_receipt'")
    const canonical = next.indexOf("v_config_source:='canonical'")
    const validate = next.indexOf("where c.id=v_config and c.variant_id=v_variant and c.status='active' and c.allow_ord")
    expect(explicit).toBeGreaterThan(0)
    expect(previous).toBeGreaterThan(explicit)
    expect(canonical).toBeGreaterThan(previous)
    expect(validate).toBeGreaterThan(canonical)
    expect(next.indexOf('warehouse_receipt_order_already_fully_received')).toBeGreaterThan(validate)
  })

  it('keeps conflicting explicit lines and variants not on the order blocked', () => {
    expect(next).toContain('if v_order_item_rows=0 or v_config_count>1 then')
  })

  it('uses continuity from receipt lines, else their movements, ignoring legacy cut-over codes', () => {
    expect(next).toContain('coalesce(ri.stock_config_id,sm.stock_config_id)')
    expect(next).toContain('left join public.stock_movements sm on sm.id=ri.stock_movement_id')
    expect(next).toContain('ri.received_now>0')
    expect(next).toContain('pc.config_code<>all(public.legacy_cutover_config_codes())')
    expect(next).toContain('(previous receipts landed in more than one configuration)')
  })

  it('reuses the canonical resolver and fails closed on none / ambiguous', () => {
    expect(next).toContain('v_config:=public.resolve_operational_stock_config(v_variant);')
    expect(next).toContain('exception when no_data_found or cardinality_violation then')
    expect(next).not.toContain('resolve_default_stock_config')
    expect(next).not.toMatch(/'20NB'|'STD'/)
  })

  it('preserves partial receiving, extra handling and the fully-received rule', () => {
    for (const fragment of [
      "v_order.order_type<>'H2M'",
      'perform public.inventory_cutoff_assert_not_frozen(p_warehouse_org_id);',
      "pg_advisory_xact_lock(hashtextextended('warehouse-receipt:'||p_batch_id::text,0))",
      "if v_received>0 and v_previous>=v_ordered then",
      'v_extra:=greatest(v_cumulative-v_ordered,0);',
      'p_quantity_change=>v_received',
      'p_stock_config_id=>v_config',
      "'idempotent_replay',true",
    ]) expect(next).toContain(fragment)
  })

  it('every later redefinition of post_warehouse_receipt keeps the resolution block verbatim', () => {
    const block = (body: string) => body.slice(
      body.indexOf('    -- Inventory destination (stock configuration)'),
      body.indexOf("    select coalesce(sum(qty),0)::integer,coalesce(max(unit_price),0)"),
    )
    const later = readdirSync(migrations)
      .filter((f) => f.endsWith('.sql') && f > NAME)
      .filter((f) => /function\s+public\.post_warehouse_receipt/i.test(readFileSync(path.join(migrations, f), 'utf-8')))
    for (const f of later) expect(block(fnBody(readFileSync(path.join(migrations, f), 'utf-8')))).toBe(block(next))
  })
})
