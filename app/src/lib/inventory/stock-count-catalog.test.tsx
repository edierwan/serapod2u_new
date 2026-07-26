import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildInitialClassificationGroups } from './stock-count-classification'
import { buildClassificationWorksheet, buildStockCountWorksheet } from './stock-count-excel'
import {
  buildStockCountCatalogRows,
  getStockCountLocationOptions,
  isStockCountCatalogRowVisible,
  matchesStockCountSearch,
  resolveStockCountDefaultWarehouseId,
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

  it('returns only active WH organizations for every Stock Count type', () => {
    const locations = [
      { id: 'hq', org_code: 'HQ', org_name: 'Headquarters', org_type_code: 'HQ', is_active: true },
      { id: 'balakong', org_code: 'WH003', org_name: 'Serapod Warehouse Balakong', org_type_code: 'WH', is_active: true },
      { id: 'alma', org_code: 'WH002', org_name: 'Serapod Warehouse Alma', org_type_code: 'WH', is_active: true },
      { id: 'hq-warehouse', org_code: 'WH001', org_name: 'Serapod HQ Warehouse', org_type_code: 'WH', is_active: true },
      { id: 'inactive-wh', org_code: 'WH009', org_name: 'Inactive Warehouse', org_type_code: 'WH', is_active: false },
      { id: 'distributor', org_code: 'DT003', org_name: 'Distributor1', org_type_code: 'DIST', is_active: true },
      { id: 'manufacturer', org_code: 'M001', org_name: 'Manufacturer', org_type_code: 'MFG', is_active: true },
      { id: 'shop', org_code: 'S001', org_name: 'Shop One', org_type_code: 'SHOP', is_active: true },
      { id: 'consumer', org_code: 'C001', org_name: 'End User', org_type_code: 'CONSUMER', is_active: true },
    ]

    expect(getStockCountLocationOptions(locations).map(location => location.id))
      .toEqual(['hq-warehouse', 'alma', 'balakong'])
  })

  it('uses only a valid configured or current-organization warehouse as default', () => {
    const warehouses = [{ id: 'alma' }, { id: 'balakong' }]
    expect(resolveStockCountDefaultWarehouseId('balakong', 'alma', warehouses)).toBe('balakong')
    expect(resolveStockCountDefaultWarehouseId('distributor', 'alma', warehouses)).toBe('alma')
    expect(resolveStockCountDefaultWarehouseId('distributor', 'shop', warehouses)).toBe('')
    expect(resolveStockCountDefaultWarehouseId(null, null, warehouses)).toBe('')
  })

  describe('group configuration eligibility', () => {
    const deviceProduct = {
      id: 'device-product', product_name: 'Serapod Device',
      product_groups: { id: 'device-group', group_name: 'Serapod Device S.Line', group_description: null, stock_config_profile: 'standard' },
      brands: null,
    }
    const deviceVariant = (variantId: string) => ({
      id: variantId, variant_name: variantId, alternative_name: null,
      variant_code: variantId.toUpperCase(), product_code: variantId.toUpperCase(),
      manufacturer_sku: null, manual_sku: null, image_url: null, base_cost: 10,
      products: deviceProduct,
    })
    const deviceConfig = (id: string, variantId: string, code: string, volume: number | null, packaging: string | null, status = 'active') => ({
      id, variant_id: variantId, config_code: code, config_label: code, stock_sku: `${id}-SKU`,
      volume_ml: volume, packaging, status, product_variants: deviceVariant(variantId),
    })

    it('marks Device concentration configurations ineligible and hides zero-balance phantoms', () => {
      const rows = buildStockCountCatalogRows([
        deviceConfig('dev-std', 'arctic', 'STD', null, null),
        deviceConfig('dev-unc', 'arctic', 'UNCLASSIFIED', null, null, 'phase_out'),
        deviceConfig('dev-20nb', 'arctic', '20NB', 20, 'new_box'),
        deviceConfig('dev-50nb', 'arctic', '50NB', 50, 'new_box'),
      ], [
        // Device carries real Unclassified stock (like Arctic 1,072).
        { id: 'inv-unc', stock_config_id: 'dev-unc', variant_id: 'arctic', quantity_on_hand: 1072, quantity_allocated: 0, warehouse_location: null },
      ])
      const byId = new Map(rows.map(row => [row.stockConfigId, row]))
      // Concentration configs are ineligible for the Device (standard) group.
      expect(byId.get('dev-20nb')?.eligible).toBe(false)
      expect(byId.get('dev-50nb')?.eligible).toBe(false)
      // The single Standard config and the Unclassified balance are eligible.
      expect(byId.get('dev-std')?.eligible).toBe(true)
      expect(byId.get('dev-unc')?.eligible).toBe(true)
      // Zero-balance phantom concentration configs disappear from the UI.
      expect(isStockCountCatalogRowVisible(byId.get('dev-20nb')!, false)).toBe(false)
      expect(isStockCountCatalogRowVisible(byId.get('dev-50nb')!, false)).toBe(false)
      // Standard config + Unclassified-with-balance remain visible.
      expect(isStockCountCatalogRowVisible(byId.get('dev-std')!, false)).toBe(true)
      expect(isStockCountCatalogRowVisible(byId.get('dev-unc')!, false)).toBe(true)
    })

    it('keeps an ineligible configuration visible if it still holds a balance (never silently dropped)', () => {
      const [row] = buildStockCountCatalogRows(
        [deviceConfig('dev-20nb', 'arctic', '20NB', 20, 'new_box')],
        [{ id: 'inv', stock_config_id: 'dev-20nb', variant_id: 'arctic', quantity_on_hand: 5, quantity_allocated: 0, warehouse_location: null }],
      )
      expect(row.eligible).toBe(false)
      expect(isStockCountCatalogRowVisible(row, false)).toBe(true)
    })

    it('does not filter Cartridge concentration configs (explicit concentration profile)', () => {
      const cartConfig = (id: string, code: string, volume: number, packaging: string) => ({
        id, variant_id: 'durian', config_code: code, config_label: code, stock_sku: `${id}-SKU`,
        volume_ml: volume, packaging, status: 'active',
        product_variants: {
          id: 'durian', variant_name: 'Durian', alternative_name: null, variant_code: 'DUR', product_code: 'DUR',
          manufacturer_sku: null, manual_sku: null, image_url: null, base_cost: 12,
          products: { id: 'cart-product', product_name: 'Cellera', product_groups: { id: 'cartridge', group_name: 'Cartridge', group_description: null, stock_config_profile: 'concentration' }, brands: null },
        },
      })
      const rows = buildStockCountCatalogRows([cartConfig('c20', '20NB', 20, 'new_box'), cartConfig('c50', '50NB', 50, 'new_box')], [])
      expect(rows.every(row => row.eligible)).toBe(true)
      expect(rows.every(row => isStockCountCatalogRowVisible(row, false))).toBe(true)
    })
  })
})
