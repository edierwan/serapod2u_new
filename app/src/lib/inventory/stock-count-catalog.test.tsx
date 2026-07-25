import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildInitialClassificationGroups } from './stock-count-classification'
import { buildClassificationWorksheet, buildStockCountWorksheet } from './stock-count-excel'
import {
  buildStockCountCatalogRows,
  getStockCountLocationOptions,
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

function classificationConfigs(
  variantId: string,
  productName: string,
  group: unknown,
  brand: unknown,
) {
  const productVariants = {
    id: variantId,
    variant_name: `${productName} [ ${variantId} ]`,
    alternative_name: null,
    variant_code: variantId.toUpperCase(),
    product_code: variantId.toUpperCase(),
    manufacturer_sku: null,
    manual_sku: null,
    image_url: null,
    base_cost: 14,
    products: {
      id: `${variantId}-product`,
      product_name: productName,
      product_groups: group,
      brands: brand,
    },
  }
  return [
    { id: `${variantId}-legacy`, variant_id: variantId, config_code: 'UNCLASSIFIED', config_label: 'Legacy / Unclassified', stock_sku: `${variantId}-UNC`, volume_ml: null, packaging: null, status: 'phase_out', product_variants: productVariants },
    { id: `${variantId}-20nb`, variant_id: variantId, config_code: '20NB', config_label: '20ml New Box', stock_sku: `${variantId}-20NB`, volume_ml: 20, packaging: 'new_box', status: 'active', product_variants: productVariants },
    { id: `${variantId}-50nb`, variant_id: variantId, config_code: '50NB', config_label: '50ml New Box', stock_sku: `${variantId}-50NB`, volume_ml: 50, packaging: 'new_box', status: 'active', product_variants: productVariants },
    { id: `${variantId}-50ob`, variant_id: variantId, config_code: '50OB', config_label: '50ml Old Box', stock_sku: `${variantId}-50OB`, volume_ml: 50, packaging: 'old_box', status: 'phase_out', product_variants: productVariants },
  ]
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

  it('keeps the canonical UI and Initial Classification export variant IDs identical across brands and nullable optional relationships', () => {
    const cartridge = { id: 'cartridge', group_name: 'Cartridge', group_description: null }
    const configurations = [
      ...classificationConfigs('hero-flavour', 'Cellera Hero', cartridge, { id: 'hero-brand', brand_name: 'Hero', logo_url: null }),
      // A missing optional brand must not remove an otherwise eligible variant.
      ...classificationConfigs('zero-flavour', 'Cellera Zero', cartridge, null),
      ...classificationConfigs('already-classified', 'Cellera Hero', cartridge, null),
    ]
    const balances = [
      { id: 'hero-legacy-balance', stock_config_id: 'hero-flavour-legacy', quantity_on_hand: 8743, is_active: true },
      { id: 'zero-legacy-balance', stock_config_id: 'zero-flavour-legacy', quantity_on_hand: 25, is_active: true },
      { id: 'classified-legacy-balance', stock_config_id: 'already-classified-legacy', quantity_on_hand: 0, is_active: true },
    ]
    const catalogRows = buildStockCountCatalogRows(configurations, balances)
    const groups = buildInitialClassificationGroups(catalogRows)
    const uiVariantIds = groups.map(group => group.variantId)

    const workbook = new ExcelJS.Workbook()
    const sheet = buildClassificationWorksheet(workbook, groups.flatMap(group => [
      {
        stockConfigId: group.legacyRow.stockConfigId,
        stockSku: group.legacyRow.stockSku,
        variantId: group.variantId,
        groupName: group.legacyRow.groupName,
        productName: group.productName,
        variantName: group.variantName,
        productCode: group.legacyRow.productCode,
        volumeMl: null,
        packagingVersion: null,
        lifecycle: group.legacyRow.configLabel,
        isLegacy: true,
        legacySystemQuantity: group.legacyRow.systemQuantity,
        physicalCount: '0',
        classifiedTotal: 0,
        variance: -group.legacyRow.systemQuantity,
      },
      ...group.targetRows.map(row => ({
        stockConfigId: row.stockConfigId,
        stockSku: row.stockSku,
        variantId: group.variantId,
        groupName: row.groupName,
        productName: group.productName,
        variantName: group.variantName,
        productCode: row.productCode,
        volumeMl: row.volumeMl,
        packagingVersion: row.packagingVersion,
        lifecycle: row.configLabel,
        isLegacy: false,
        legacySystemQuantity: group.legacyRow.systemQuantity,
        physicalCount: '',
        classifiedTotal: 0,
        variance: -group.legacyRow.systemQuantity,
      })),
    ]))
    const exportVariantIds = [...new Set(
      Array.from({ length: sheet.rowCount - 1 }, (_, index) => sheet.getRow(index + 2).getCell(3).text)
        .filter(Boolean),
    )]

    expect(uiVariantIds).toEqual(['hero-flavour', 'zero-flavour'])
    expect(exportVariantIds).toEqual(uiVariantIds)
    expect(catalogRows.filter(row => row.variantId === 'hero-flavour')).toHaveLength(4)
  })

  it('allows distributor stock locations only for Initial Configuration Classification', () => {
    const locations = [
      { id: 'hq', org_code: 'HQ', org_name: 'HQ', org_type_code: 'HQ' },
      { id: 'warehouse', org_code: 'WH001', org_name: 'Balakong Warehouse', org_type_code: 'WH' },
      { id: 'distributor', org_code: 'D001', org_name: 'Distributor One', org_type_code: 'DIST' },
      { id: 'shop', org_code: 'S001', org_name: 'Shop One', org_type_code: 'SHOP' },
    ]

    expect(getStockCountLocationOptions(locations, false).map(location => location.id))
      .toEqual(['hq', 'warehouse'])
    expect(getStockCountLocationOptions(locations, true).map(location => location.id))
      .toEqual(['hq', 'warehouse', 'distributor'])
  })
})
