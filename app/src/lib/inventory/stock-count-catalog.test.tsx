import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildStockCountWorksheet } from './stock-count-excel'
import {
  buildStockCountCatalogRows,
  isStockCountCatalogRowVisible,
  matchesStockCountSearch,
} from './stock-count-catalog'

function config(overrides: Record<string, unknown> = {}) {
  return {
    id: 'durian-20nb', variant_id: 'durian', config_code: '20NB', config_label: '20ml · New Box',
    stock_sku: 'DUR-20NB', volume_ml: 20, packaging: 'new_box', status: 'active',
    product_variants: {
      id: 'durian', variant_name: 'Deluxe Cellera Cartridge [ Durian ]', alternative_name: 'Durian Belanda',
      variant_code: 'DUR-001', product_code: 'DB', manufacturer_sku: 'SKU-DUR', manual_sku: null,
      image_url: null, base_cost: 14,
      products: { id: 'hero', product_name: 'Cellera Hero', product_groups: { id: 'cartridge', group_name: 'Cartridge', group_description: null }, brands: null },
    },
    ...overrides,
  }
}

describe('Stock Count configuration-first catalog', () => {
  it('includes a new active Durian configuration with zero quantities and no inventory row', () => {
    const [row] = buildStockCountCatalogRows([config()], [])
    expect(row).toMatchObject({
      inventoryId: null,
      variantId: 'durian',
      stockConfigId: 'durian-20nb',
      systemQuantity: 0,
      quantityAllocated: 0,
    })
    expect(isStockCountCatalogRowVisible(row, false)).toBe(true)
  })

  it.each(['Durian', 'Durian Belanda', 'DB', '  durian belanda  '])('finds Durian with %s', (search) => {
    const [row] = buildStockCountCatalogRows([config()], [])
    expect(matchesStockCountSearch(row, search)).toBe(true)
  })

  it('overlays an existing warehouse balance without changing it', () => {
    const [row] = buildStockCountCatalogRows([config()], [{
      id: 'inventory-1', stock_config_id: 'durian-20nb', variant_id: 'durian',
      quantity_on_hand: 25, quantity_allocated: 4, warehouse_location: 'A-01',
    }])
    expect(row).toMatchObject({ inventoryId: 'inventory-1', systemQuantity: 25, quantityAllocated: 4, warehouseLocation: 'A-01' })
  })

  it('exports the eligible zero-balance Durian configuration to Stock Count Excel', () => {
    const [row] = buildStockCountCatalogRows([config()], [])
    const workbook = new ExcelJS.Workbook()
    const sheet = buildStockCountWorksheet(workbook, [{
      stockConfigId: row.stockConfigId,
      stockSku: row.stockSku,
      variantId: row.variantId,
      volumeMl: row.volumeMl,
      packagingVersion: row.packagingVersion,
      groupName: row.groupName,
      variantName: row.variantName,
      productName: row.productName,
      productCode: row.productCode,
      systemQuantity: row.systemQuantity,
      physicalCount: row.physicalCount,
      note: row.note,
    }])

    expect(sheet.getRow(2).values).toEqual(expect.arrayContaining([
      'durian-20nb',
      'DUR-20NB',
      'Deluxe Cellera Cartridge [ Durian ]',
      'DB',
      0,
    ]))
  })

  it('includes positive phase-out stock but hides zero phase-out and inactive configurations by default', () => {
    const phaseOut = config({ id: 'durian-50ob', config_code: '50OB', status: 'phase_out' })
    const [positive] = buildStockCountCatalogRows([phaseOut], [{ stock_config_id: 'durian-50ob', quantity_on_hand: 3 }])
    const [zero] = buildStockCountCatalogRows([phaseOut], [])
    const [inactive] = buildStockCountCatalogRows([config({ status: 'inactive' })], [{ stock_config_id: 'durian-20nb', quantity_on_hand: 3 }])
    expect(isStockCountCatalogRowVisible(positive, false)).toBe(true)
    expect(isStockCountCatalogRowVisible(zero, false)).toBe(false)
    expect(isStockCountCatalogRowVisible(zero, true)).toBe(true)
    expect(isStockCountCatalogRowVisible(inactive, false)).toBe(false)
  })

  it('fails closed if duplicate inventory rows exist', () => {
    expect(() => buildStockCountCatalogRows([config()], [
      { id: 'one', stock_config_id: 'durian-20nb' },
      { id: 'two', stock_config_id: 'durian-20nb' },
    ])).toThrow(/Duplicate inventory balance/)
  })
})
