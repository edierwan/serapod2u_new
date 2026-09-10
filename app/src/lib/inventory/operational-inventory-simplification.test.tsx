import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { aggregateVariantInventory, type InventoryConfigRow } from './inventory-view-aggregation'

const source = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, `../../${relativePath}`), 'utf8')

const inventoryView = source('components/inventory/InventoryView.tsx')
const adjustment = source('components/inventory/StockAdjustmentView.tsx')
const movementReport = source('components/inventory/StockMovementReportView.tsx')

const row = (overrides: Partial<InventoryConfigRow> = {}): InventoryConfigRow => ({
  id: `row-${Math.random().toString(36).slice(2)}`,
  organization_id: 'wh-1',
  organization_name: 'Serapod Warehouse Balakong',
  organization_code: 'WH001',
  variant_id: 'var-bv',
  stock_config_id: 'cfg-20nb',
  variant_name: 'Deluxe Cellera Cartridge [ Banana Vanilla ]',
  variant_product_code: 'BV',
  alternative_name: 'Banana Milk',
  product_name: 'Cellera Hero',
  config_code: '20NB',
  config_label: '20ml · New Box',
  volume_ml: 20,
  packaging: 'new_box',
  stock_config_status: 'active',
  quantity_on_hand: 5520,
  quantity_allocated: 0,
  quantity_available: 5520,
  ...overrides,
} as InventoryConfigRow)

const noIncoming = () => 0

describe('Inventory View simplifies only once legacy stock is actually retired', () => {
  it('keeps the detail while a legacy balance is still on hand', () => {
    const [summary] = aggregateVariantInventory([
      row(),
      row({ stock_config_id: 'cfg-50nb', config_code: '50NB', config_label: '50ml · New Box', volume_ml: 50, quantity_on_hand: 1300, quantity_available: 1300 }),
      row({ stock_config_id: 'cfg-unc', config_code: 'UNCLASSIFIED', config_label: 'Unclassified (pending stock take)', volume_ml: null, packaging: null, stock_config_status: 'phase_out', quantity_on_hand: 27, quantity_available: 27 }),
    ], noIncoming)

    expect(summary.hasUnretiredLegacy).toBe(true)
    expect(summary.legacyOnHand).toBe(1327)
    expect(summary.operationalOnly).toBe(false)

    // The headline On Hand INCLUDES the legacy stock, which is exactly why the
    // detail may not be collapsed away at this point.
    expect(summary.onHand).toBe(5520 + 1300 + 27)
  })

  it('counts allocated legacy stock as unretired too', () => {
    const [summary] = aggregateVariantInventory([
      row(),
      row({ stock_config_id: 'cfg-50nb', config_code: '50NB', quantity_on_hand: 0, quantity_allocated: 40, quantity_available: -40 }),
    ], noIncoming)

    expect(summary.hasUnretiredLegacy).toBe(true)
    expect(summary.legacyOnHand).toBe(40)
  })

  it('collapses to one operational row once every legacy balance is zero', () => {
    const [summary] = aggregateVariantInventory([
      row(),
      row({ stock_config_id: 'cfg-50nb', config_code: '50NB', config_label: '50ml · New Box', volume_ml: 50, stock_config_status: 'inactive', quantity_on_hand: 0, quantity_allocated: 0, quantity_available: 0 }),
      row({ stock_config_id: 'cfg-unc', config_code: 'UNCLASSIFIED', config_label: 'Unclassified (pending stock take)', volume_ml: null, packaging: null, stock_config_status: 'inactive', quantity_on_hand: 0, quantity_allocated: 0, quantity_available: 0 }),
    ], noIncoming)

    expect(summary.hasUnretiredLegacy).toBe(false)
    expect(summary.legacyOnHand).toBe(0)
    expect(summary.operationalOnly).toBe(true)
    expect(summary.onHand).toBe(5520)
  })

  it('never treats STD as legacy, though it carries no volume or packaging', () => {
    // STD is the canonical configuration for every non-vape product. The
    // display-level isLegacyConfigRow() calls it legacy because it is
    // dimensionless; the retirement gate must not.
    const [summary] = aggregateVariantInventory([
      row({ variant_id: 'var-tumbler', stock_config_id: 'cfg-std', config_code: 'STD', config_label: 'Standard', volume_ml: null, packaging: null, product_name: 'SERAPOD® TUMBLER', variant_name: 'SERAPOD® TUMBLER 1L', quantity_on_hand: 250, quantity_available: 250 }),
    ], noIncoming)

    expect(summary.legacyOnHand).toBe(0)
    expect(summary.hasUnretiredLegacy).toBe(false)
    expect(summary.operationalOnly).toBe(true)
  })

  it('treats a variant that never had a legacy configuration as operational', () => {
    const [summary] = aggregateVariantInventory([
      row({ variant_id: 'var-std', stock_config_id: 'cfg-std', config_code: 'STD', config_label: 'Standard', volume_ml: null, packaging: null, quantity_on_hand: 12, quantity_available: 12 }),
    ], noIncoming)

    expect(summary.operationalOnly).toBe(true)
    expect(summary.hasUnretiredLegacy).toBe(false)
  })
})

describe('Inventory View wiring', () => {
  it('drops the expander only for operational-only rows', () => {
    expect(inventoryView).toContain('const configurationDetailAvailable = !summary.operationalOnly')
    expect(inventoryView).toContain('const expanded = configurationDetailAvailable && expandedVariants.has(summary.key)')
    expect(inventoryView).toContain('if (!configurationDetailAvailable) return')
  })

  it('never hides a non-zero legacy balance silently', () => {
    expect(inventoryView).toContain('summary.hasUnretiredLegacy && (')
    expect(inventoryView).toContain('legacy · pre-cutover')
    expect(inventoryView).toContain('summary.legacyOnHand.toLocaleString()')
    expect(inventoryView).toContain('is included in the On Hand total')
  })

  it('restricts the retired-configuration toggle to inventory administrators', () => {
    expect(inventoryView).toContain('{canEditSettings() && (')
    expect(inventoryView).toContain('Show retired zero-balance configurations')
    expect(inventoryView).toContain('Audit')
    // The old unrestricted label is gone.
    expect(inventoryView).not.toContain('Show inactive zero-balance configurations')
  })
})

describe('Stock Adjustment / Stock Count operational rows', () => {
  it('shows the configuration badge only where a variant really carries two', () => {
    expect(adjustment).toContain('shouldShowConfigurationColumn(visibleRows)')
    expect(adjustment).toContain("{showConfiguration ? 'Variant / Stock Configuration' : 'Variant'}")
    expect(adjustment).toContain('{showConfiguration && <Badge')
  })

  it('keeps the legacy classification sub-table fully configuration-aware', () => {
    // This is the tool that RESOLVES a legacy balance, so hiding configuration
    // inside it would remove the only information it exists to capture.
    expect(adjustment).toContain('Legacy Source — Read Only')
    expect(adjustment).toContain('there the configuration IS the')
  })
})

describe('historical and audit surfaces keep configuration permanently', () => {
  it('leaves Movement Reports untouched by the operational simplification', () => {
    expect(movementReport).toContain('Stock SKU / Configuration')
    expect(movementReport).not.toContain('shouldShowConfigurationColumn')
    expect(movementReport).not.toContain('operationalOnly')
  })
})
