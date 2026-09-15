import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migrations = path.resolve(__dirname, '../../../../supabase/migrations')
const NAME = '20260915140000_warehouse_receipt_receive_limit.sql'
const sql = readFileSync(path.join(migrations, NAME), 'utf-8')
const applied = readFileSync(path.join(migrations, '20260915130000_warehouse_receipt_config_resolution.sql'), 'utf-8')

const fnBody = (text: string) => {
  const start = text.indexOf('create or replace function public.post_warehouse_receipt(')
  return text.slice(start, text.indexOf(') to authenticated;', start))
}
const next = fnBody(sql)
const prev = fnBody(applied)
const executable = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

describe('post_warehouse_receipt receive limit — SQL', () => {
  it('changes no schema: one function, grants and comment only', () => {
    expect(executable).not.toMatch(/\b(alter\s+table|create\s+table|create\s+index|add\s+column|drop\s+|create\s+type)\b/i)
    expect(executable.match(/create or replace function/gi)).toHaveLength(1)
    expect(executable).toContain('grant execute on function public.post_warehouse_receipt(')
  })

  it('is the applied 20260915130000 body with only the limit check changed', () => {
    const LIMIT_START = '    -- Receive limit per line (cases):'
    const LIMIT_END = "    v_cumulative:=v_previous+v_received;"
    const withoutLimit = next.slice(0, next.indexOf(LIMIT_START)) + next.slice(next.indexOf(LIMIT_END))
    const OLD_START = "    if v_received>0 and v_previous>=v_ordered then"
    const prevWithoutCheck = prev.slice(0, prev.indexOf(OLD_START)) + prev.slice(prev.indexOf(LIMIT_END))
    const normalized = withoutLimit
      .replace('  v_warranty_bonus numeric := 0;\n  v_buffer_allowance integer;\n  v_max_cumulative integer;\n', '')
      .replace(/  -- Manufacturer warranty %[\s\S]*?  v_warranty_bonus:=coalesce\(v_warranty_bonus,0\);\n/, '')
    expect(normalized).toBe(prevWithoutCheck)
  })

  it('reads the manufacturer warranty % from the validated order seller', () => {
    expect(next).toContain('select coalesce(warranty_bonus,0) into v_warranty_bonus')
    expect(next).toContain('from public.organizations where id=v_order.seller_org_id;')
    expect(next.indexOf('v_order.seller_org_id<>p_manufacturer_org_id')).toBeLessThan(next.indexOf('into v_warranty_bonus'))
  })

  it('caps cumulative receipt at ordered + floor(ordered × warranty %)', () => {
    expect(next).toContain('v_buffer_allowance:=floor(v_ordered*v_warranty_bonus/100)::integer;')
    expect(next).toContain('v_max_cumulative:=v_ordered+greatest(v_buffer_allowance,0);')
    expect(next).toContain("if v_received>0 and v_previous>=v_max_cumulative then\n      raise exception 'warehouse_receipt_order_already_fully_received: variant %',v_variant;")
    expect(next).toContain("if v_received>0 and v_previous+v_received>v_max_cumulative then\n      raise exception 'warehouse_receipt_exceeds_allowed_quantity: variant % (maximum receivable now %)'")
    expect(next).not.toContain('if v_received>0 and v_previous>=v_ordered then')
  })

  it('checks the limit before posting any movement for the line', () => {
    expect(next.indexOf('warehouse_receipt_exceeds_allowed_quantity')).toBeLessThan(next.indexOf('select public.record_stock_movement('))
  })

  it('is the latest migration defining post_warehouse_receipt', () => {
    const later = readdirSync(migrations)
      .filter((f) => f.endsWith('.sql') && f > NAME)
      .filter((f) => /function\s+public\.post_warehouse_receipt/i.test(readFileSync(path.join(migrations, f), 'utf-8')))
    expect(later).toEqual([])
  })
})
