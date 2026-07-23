import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../../supabase/migrations/20260723_stock_count_configuration_scope.sql', import.meta.url),
  'utf8',
)
const stockAdjustmentView = readFileSync(
  new URL('../../components/inventory/StockAdjustmentView.tsx', import.meta.url),
  'utf8',
)

describe('Stock Count configuration scope migration', () => {
  it('snapshots configurations uniquely per session without touching inventory', () => {
    expect(migration).toContain('primary key (session_id, stock_config_id)')
    expect(migration).toMatch(/references public\.stock_count_sessions\(id\) on delete cascade/i)
    expect(migration).not.toMatch(/insert into public\.product_inventory|update public\.product_inventory/i)
  })

  it('backfills historical scope only from already-saved draft items', () => {
    expect(migration).toContain('from public.stock_count_session_items items')
    expect(migration).toContain('where items.stock_config_id is not null')
    expect(migration).not.toMatch(/select[\s\S]*from public\.inventory_stock_configurations[\s\S]*insert/i)
  })

  it('uses the existing warehouse access model and only allows insert into drafts', () => {
    expect(migration).toContain('public.can_access_org(sessions.warehouse_organization_id)')
    expect(migration).toContain('public.is_hq_admin()')
    expect(migration).toContain("sessions.status = 'draft'")
  })

  it('wires Full Count, Partial Count, Excel export, and import to the same eligible catalog', () => {
    expect(stockAdjustmentView).toContain(".from('inventory_stock_configurations')")
    expect(stockAdjustmentView).toContain('buildStockCountCatalogRows(configurationResult.data || [], balanceResult.data || [])')
    expect(stockAdjustmentView).toContain('const scoped = selectedGroupId === ALL_GROUP_ID ? visibleRows')
    expect(stockAdjustmentView).toContain('buildStockCountWorksheet(workbook, visibleRows.map')
    expect(stockAdjustmentView).toContain('parseStockCountWorksheet(sheet, visibleRows.map')
  })
})
