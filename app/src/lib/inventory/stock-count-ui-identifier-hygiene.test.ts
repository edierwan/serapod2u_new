import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoFile = (path: string) => fs.readFileSync(
  new URL(`../../../../${path}`, import.meta.url),
  'utf8',
)
const stockCountView = repoFile('app/src/components/inventory/StockAdjustmentView.tsx')
const cutoffSection = repoFile('app/src/components/inventory/InventoryOpeningCutoffSection.tsx')

describe('Stock Count UI identifier hygiene', () => {
  it('does not render the generated SKU/configuration identifier on item rows', () => {
    // The generated stock SKU line (e.g. SAG-102430-UNC-<uuid-tail>) is removed
    // from the row. skuForRow remains for internal save/Excel/matching only.
    expect(stockCountView).not.toContain('<span className="font-mono text-xs text-slate-500">{skuForRow(row)}</span>')
    // Still used internally when persisting session items.
    expect(stockCountView).toContain('sku: skuForRow(row)')
  })

  it('shows the warehouse name instead of the warehouse UUID for invalid-warehouse drafts', () => {
    expect(stockCountView).not.toContain('({draft.warehouse_organization_id})')
    expect(stockCountView).toContain("|| 'Warehouse unavailable'")
  })

  it('passes human-readable warehouse and draft references into the Opening Balance section', () => {
    expect(stockCountView).toContain('warehouseName={warehouseName}')
    expect(stockCountView).toContain('draftReference={')
  })

  it('never renders the raw session/warehouse/category UUID in the Opening Balance section', () => {
    // Old leaks that must be gone.
    expect(cutoffSection).not.toContain('font-mono text-xs">{sessionId}')
    expect(cutoffSection).not.toContain('Warehouse: {warehouseOrganizationId')
    expect(cutoffSection).not.toContain('{report.warehouse_organization_id}')
    expect(cutoffSection).not.toContain('{item.cutoff_id}')
    // Human-readable labels with neutral fallbacks are used instead.
    expect(cutoffSection).toContain("|| 'Warehouse unavailable'")
    expect(cutoffSection).toContain("|| 'Category unavailable'")
    expect(cutoffSection).toContain('{draftLabel}')
    expect(cutoffSection).toContain('{warehouseLabel}')
  })

  it('keeps internal UUIDs available for API calls and routing', () => {
    // sessionId still drives cutoff lookups and verification requests.
    expect(cutoffSection).toContain('.eq(\'stock_count_session_id\', sessionId)')
    expect(cutoffSection).toContain('sessionId: activeCutoff.stock_count_session_id')
  })
})
