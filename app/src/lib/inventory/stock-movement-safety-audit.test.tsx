import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')

const schema = repoFile('supabase/schemas/current_schema_stg.sql')
const migration = repoFile('supabase/migrations/20260716_stock_movement_history_balance_fix_04.sql')
const report = repoFile('app/src/components/inventory/StockMovementReportView.tsx')
const movementsApi = repoFile('app/src/app/api/movements/route.ts')

const functionBodies = Array.from(
  schema.matchAll(/CREATE FUNCTION public\.([a-zA-Z0-9_]+)\([^;]*?AS \$\$(.*?)\$\$;/gs),
  match => ({ name: match[1], body: match[2] }),
)

describe('stock movement consumer audit contract', () => {
  it('routes active application closing-balance consumers through the shared helper', () => {
    expect(report).toContain('resolveStockMovementHistoryValues')
    expect(movementsApi).toContain('historicalQuantityAfter(row.quantity_before, row.quantity_change)')
  })

  it('corrects all schema views that expose quantity_after', () => {
    const viewNames = Array.from(
      schema.matchAll(/CREATE VIEW public\.([a-zA-Z0-9_]+) AS\s+(.*?);/gs),
      match => ({ name: match[1], body: match[2] }),
    )
      .filter(view => view.body.includes('quantity_after'))
      .map(view => view.name)
      .sort()

    expect(viewNames).toEqual([
      'v_stock_movements_display',
      'v_wms_movements_recent',
      'vw_stock_movements_ordered',
    ])

    for (const viewName of viewNames) {
      expect(migration).toContain(`CREATE OR REPLACE VIEW public.${viewName}`)
    }
  })
})

describe('stock movement writer audit contract', () => {
  it('keeps an explicit inventory of every direct SQL writer in the staging schema', () => {
    const directWriters = functionBodies
      .filter(fn => fn.body.includes('INSERT INTO public.stock_movements'))
      .map(fn => fn.name)
      .sort()

    expect(directWriters).toEqual([
      'allocate_inventory_for_order',
      'fn_test_balance_request_flow',
      'fulfill_order_inventory',
      'log_qr_receive_movement',
      'log_qr_shipment_movement',
      'orders_approve',
      'record_stock_movement',
      'release_allocation_for_order',
      'wms_record_movement_from_summary',
      'wms_ship_manual',
    ])
  })

  it('keeps an explicit inventory of SQL services that delegate to record_stock_movement', () => {
    const rpcWriters = functionBodies
      .filter(fn => fn.name !== 'record_stock_movement' && /record_stock_movement\s*\(/.test(fn.body))
      .map(fn => fn.name)
      .sort()

    expect(rpcWriters).toEqual([
      'delete_scratch_campaign',
      'post_warehouse_receipt',
      'verify_and_post_stock_count',
      'wms_reverse_manual_movement',
      'wms_ship_mixed',
    ])
  })

  it('serializes the authoritative writer before its balance read', () => {
    const replacement = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.record_stock_movement'))
    expect(replacement.indexOf('pg_advisory_xact_lock')).toBeLessThan(replacement.indexOf('SELECT id, quantity_on_hand'))
    expect(replacement).toContain('FOR UPDATE')
  })

  it('keeps allocation pairs invariant while validating ordinary movements against on-hand', () => {
    expect(migration).toContain("NEW.movement_type IN ('allocation', 'deallocation')")
    expect(migration).toContain('NEW.quantity_after <> NEW.quantity_before + NEW.quantity_change')
    expect(migration).toContain('v_current_qty = NEW.quantity_before OR v_current_qty = NEW.quantity_after')
  })
})
