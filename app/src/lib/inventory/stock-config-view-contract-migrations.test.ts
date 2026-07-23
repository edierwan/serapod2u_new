import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readMigration = (name: string) => readFileSync(
  new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
  'utf8',
)

const migration06 = readMigration('20260717_stock_config_06_views_reports.sql')
const migration20 = readMigration('20260719_stock_config_20_view_contract_compatibility.sql')
const rollbackVerification = readFileSync(
  new URL('../../../../supabase/diagnostics/20260719_stock_config_06_rollback_verification.sql', import.meta.url),
  'utf8',
)

// Extracted from the attached production schema after Migrations 01-05.
// Each entry is the immutable prefix that CREATE OR REPLACE VIEW must retain.
const productionContracts: Record<string, string[]> = {
  vw_inventory_on_hand: [
    'id:uuid', 'variant_id:uuid', 'organization_id:uuid', 'quantity_on_hand:integer',
    'quantity_allocated:integer', 'quantity_available:integer', 'reorder_point:integer',
    'reorder_quantity:integer', 'max_stock_level:integer', 'safety_stock:integer',
    'lead_time_days:integer', 'average_cost:numeric(12,2)', 'total_value:numeric(15,2)',
    'warehouse_location:text', 'variant_code:text', 'variant_name:text', 'variant_image_url:text',
    'product_id:uuid', 'product_name:text', 'product_code:text', 'organization_name:text',
    'organization_code:text', 'updated_at:timestamp with time zone',
  ],
  vw_manual_stock_balance: ['warehouse_id:uuid', 'variant_id:uuid', 'manual_balance_qty:bigint'],
  vw_stock_movements_ordered: [
    'id:uuid', 'movement_type:text', 'reference_type:text', 'reference_id:uuid', 'reference_no:text',
    'variant_id:uuid', 'from_organization_id:uuid', 'to_organization_id:uuid',
    'quantity_change:integer', 'quantity_before:integer', 'quantity_after:integer',
    'unit_cost:numeric(12,2)', 'total_cost:numeric(15,2)', 'manufacturer_id:uuid',
    'warehouse_location:text', 'reason:text', 'notes:text', 'company_id:uuid', 'created_by:uuid',
    'created_at:timestamp with time zone',
  ],
  v_stock_movements_display: [
    'id:uuid', 'created_at:timestamp with time zone', 'movement_type:text', 'variant_id:uuid',
    'from_organization_id:uuid', 'to_organization_id:uuid', 'quantity_change:integer',
    'quantity_before:integer', 'quantity_after:integer', 'unit_cost:numeric(12,2)',
    'reference_id:uuid', 'reason:text', 'created_by:uuid', 'reference_type:text',
  ],
  v_wms_movements_recent: [
    'created_at:timestamp with time zone', 'movement_type:text', 'reference_type:text', 'order_id:uuid',
    'variant_id:uuid', 'from_org_id:uuid', 'to_org_id:uuid', 'quantity_before:integer',
    'quantity_change:integer', 'quantity_after:integer',
  ],
  v_hq_inventory: [
    'product_id:uuid', 'product_code:text', 'product_name:text', 'variant_id:uuid',
    'variant_code:text', 'variant_name:text', 'hq_org_id:uuid', 'hq_org_name:text',
    'quantity_on_hand:integer', 'quantity_allocated:integer', 'quantity_available:integer',
    'average_cost:numeric(12,2)', 'total_value:numeric(15,2)',
  ],
  v_low_stock_alerts: [
    'id:uuid', 'organization_id:uuid', 'org_name:text', 'org_type_code:text', 'variant_id:uuid',
    'variant_code:text', 'variant_name:text', 'product_id:uuid', 'product_code:text', 'product_name:text',
    'brand_id:uuid', 'brand_name:text', 'quantity_on_hand:integer', 'quantity_allocated:integer',
    'quantity_available:integer', 'reorder_point:integer', 'reorder_quantity:integer',
    'max_stock_level:integer', 'units_below_reorder:integer', 'stock_level_percent:numeric',
    'priority:text', 'warehouse_location:text', 'last_counted_at:timestamp with time zone',
    'updated_at:timestamp with time zone',
  ],
  v_incoming_transfers_detail: [
    'company_id:uuid', 'transfer_id:uuid', 'transfer_no:text', 'status:text',
    'source_warehouse_org_id:uuid', 'source_warehouse_name:text',
    'destination_warehouse_org_id:uuid', 'destination_warehouse_name:text', 'variant_id:uuid',
    'quantity:integer', 'dispatched_at:timestamp with time zone', 'received_at:timestamp with time zone',
    'destination_posted:boolean', 'incoming_qty:integer', 'excluded_reason:text',
  ],
}

const viewBlock = (sql: string, view: string) => {
  const start = sql.search(new RegExp(`CREATE OR REPLACE VIEW public\\.${view}\\b`, 'i'))
  expect(start, `${view} definition`).toBeGreaterThanOrEqual(0)
  const next = sql.indexOf('CREATE OR REPLACE VIEW public.', start + 1)
  return sql.slice(start, next < 0 ? sql.length : next)
}

const assertNamesInOrder = (sql: string, contract: string[]) => {
  let cursor = 0
  for (const item of contract) {
    const name = item.slice(0, item.indexOf(':'))
    const next = sql.indexOf(name, cursor)
    expect(next, `${name} must retain its ordinal position`).toBeGreaterThanOrEqual(cursor)
    cursor = next + name.length
  }
}

describe('Migration 06 production view compatibility', () => {
  it('contains the exact audited production contracts for all eight replaced views', () => {
    expect(Object.keys(productionContracts)).toHaveLength(8)
    expect(productionContracts.v_hq_inventory.slice(-2)).toEqual([
      'average_cost:numeric(12,2)', 'total_value:numeric(15,2)',
    ])
    expect(productionContracts.vw_inventory_on_hand).toHaveLength(23)
    expect(productionContracts.v_incoming_transfers_detail).toHaveLength(15)
  })

  it('retains every existing column name in order and only appends configuration columns', () => {
    for (const [view, contract] of Object.entries(productionContracts)) {
      assertNamesInOrder(viewBlock(migration06, view), contract)
    }
  })

  it('preserves the confirmed HQ numeric precision and scale explicitly', () => {
    const hq = viewBlock(migration06, 'v_hq_inventory')
    expect(hq).toContain('END::numeric(12,2) AS average_cost')
    expect(hq).toContain("COALESCE(SUM(pi.total_value),0)::numeric(15,2) AS total_value")
    expect(migration06).not.toMatch(/DROP\s+VIEW/i)
  })

  it('does not redefine the four incoming or hierarchy views that Migration 06 only documents', () => {
    for (const view of [
      'v_org_hierarchy_with_stock', 'v_incoming_stock_detail',
      'v_incoming_stock_transfers', 'v_incoming_stock',
    ]) {
      expect(migration06).not.toMatch(new RegExp(`CREATE OR REPLACE VIEW public\\.${view}\\b`, 'i'))
    }
  })
})

describe('Migration 20 forward view compatibility', () => {
  it('refreshes all eight corrected definitions without dropping views or rewriting inventory data', () => {
    for (const view of Object.keys(productionContracts)) {
      expect(migration20).toMatch(new RegExp(`CREATE OR REPLACE VIEW public\\.${view}\\b`, 'i'))
    }
    expect(migration20).not.toMatch(/DROP\s+VIEW/i)
    expect(migration20).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i)
  })

  it('preserves either installed HQ numeric contract and validates catalog-derived type text', () => {
    expect(migration20).toContain("format_type(a.atttypid,a.atttypmod)")
    expect(migration20).toContain("COALESCE(v_average_cost_type,'numeric(12,2)')")
    expect(migration20).toContain("COALESCE(v_total_value_type,'numeric(15,2)')")
    expect(migration20).toContain("END::%s AS average_cost")
    expect(migration20).toContain("COALESCE(SUM(pi.total_value),0)::%s AS total_value")
  })

  it('is transaction-wrapped and definition-idempotent', () => {
    expect(migration20.trimStart()).toMatch(/^--[\s\S]*?BEGIN;/)
    expect(migration20.trimEnd()).toMatch(/COMMIT;$/)
    expect(migration20.match(/CREATE OR REPLACE VIEW/g)).toHaveLength(8)
  })

  it('ships SELECT-only rollback verification with labelled results', () => {
    expect(rollbackVerification).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE)\b/i)
    expect(rollbackVerification.match(/section_label/g)?.length).toBeGreaterThanOrEqual(4)
    expect(rollbackVerification).toContain('FULLY_ABSENT_CONSISTENT_WITH_ROLLBACK')
    expect(rollbackVerification).toContain('numeric(12,2)')
    expect(rollbackVerification).toContain('numeric(15,2)')
  })
})
