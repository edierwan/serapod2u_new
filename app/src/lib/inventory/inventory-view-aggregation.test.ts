import { describe, expect, it } from 'vitest'
import {
  aggregateVariantInventory,
  buildInventorySummaryExportRows,
  filterVariantInventorySummaries,
  isLegacyConfigRow,
  paginateVariantInventorySummaries,
  pickIncomingConfigRowId,
  sortVariantInventorySummaries,
  type InventoryConfigRow,
} from './inventory-view-aggregation'

const summaryBananaRows = (organizationId = 'warehouse-balakong'): InventoryConfigRow[] => {
  const shared = {
    organization_id: organizationId,
    organization_name: organizationId === 'warehouse-balakong' ? 'Warehouse Balakong' : 'Distributor Johor',
    variant_id: 'banana',
    variant_code: 'CEL-BANANA',
    variant_name: 'Cellera Cartridge [Banana Milk]',
    product_name: 'Cellera',
    product_code: 'CEL',
    quantity_allocated: 0,
    unit_cost: 14,
    reorder_point: 20,
    warehouse_location: 'A-01',
  }

  return [
    {
      ...shared, id: `${organizationId}-20nb`, stock_config_id: 'banana-20nb',
      config_code: '20NB', stock_sku: 'CEL-BANANA-20NB', volume_ml: 20,
      packaging: 'new_box', default_for_ord: true, stock_config_status: 'active',
      quantity_on_hand: 50, quantity_available: 50, updated_at: '2026-07-18T01:00:00.000Z',
    },
    {
      ...shared, id: `${organizationId}-50nb`, stock_config_id: 'banana-50nb',
      config_code: '50NB', stock_sku: 'CEL-BANANA-50NB', volume_ml: 50,
      packaging: 'new_box', default_for_ord: false, stock_config_status: 'active',
      quantity_on_hand: 40, quantity_available: 40, updated_at: '2026-07-18T02:00:00.000Z',
    },
    {
      ...shared, id: `${organizationId}-50ob`, stock_config_id: 'banana-50ob',
      config_code: '50OB', stock_sku: 'CEL-BANANA-50OB', volume_ml: 50,
      packaging: 'old_box', default_for_ord: false, stock_config_status: 'active',
      quantity_on_hand: 30, quantity_available: 30, updated_at: '2026-07-18T03:00:00.000Z',
    },
    {
      ...shared, id: `${organizationId}-legacy`, stock_config_id: 'banana-legacy',
      config_code: 'UNCLASSIFIED', stock_sku: 'CEL-BANANA-UNC',
      volume_ml: null, packaging: null, default_for_ord: false,
      stock_config_status: 'inactive', quantity_on_hand: 0, quantity_available: 0,
      updated_at: '2026-07-18T00:00:00.000Z',
    },
  ]
}

describe('View Inventory aggregation', () => {
  it('collapses four balances into the exact Banana summary and detail', () => {
    const [summary] = aggregateVariantInventory(summaryBananaRows(), () => 10_000)

    expect(summary).toMatchObject({
      onHand: 120,
      allocated: 0,
      available: 120,
      incoming: 10_000,
      position: 10_120,
      value: 1_680,
      hiddenConfigCount: 1,
    })
    expect(summary.configs).toHaveLength(3)
    expect(summary.configs.map(config => ({
      code: config.configCode,
      onHand: config.onHand,
      incoming: config.incoming,
      position: config.position,
      value: config.value,
    }))).toEqual([
      { code: '20NB', onHand: 50, incoming: 10_000, position: 10_050, value: 700 },
      { code: '50NB', onHand: 40, incoming: 0, position: 40, value: 560 },
      { code: '50OB', onHand: 30, incoming: 0, position: 30, value: 420 },
    ])
  })

  it('hides zero Legacy by default and exposes it only when requested', () => {
    const [hidden] = aggregateVariantInventory(summaryBananaRows(), () => 10_000)
    const [shown] = aggregateVariantInventory(summaryBananaRows(), () => 10_000, { includeInactive: true })

    expect(hidden.configs.some(config => config.isLegacy)).toBe(false)
    expect(shown.configs.find(config => config.isLegacy)).toMatchObject({
      onHand: 0,
      incoming: 0,
      value: 0,
    })
  })

  it('keeps the same variant in another organization as a separate summary', () => {
    const summaries = aggregateVariantInventory(
      [...summaryBananaRows(), ...summaryBananaRows('distributor-johor')],
      organizationId => organizationId === 'warehouse-balakong' ? 10_000 : 0,
    )

    expect(summaries).toHaveLength(2)
    expect(summaries.map(summary => summary.organizationId)).toEqual([
      'warehouse-balakong',
      'distributor-johor',
    ])
  })

  it('searches, sorts, paginates, and exports complete summary rows', () => {
    const summaries = aggregateVariantInventory(
      [...summaryBananaRows(), ...summaryBananaRows('distributor-johor')],
      organizationId => organizationId === 'warehouse-balakong' ? 10_000 : 0,
    )

    // Matching one configuration SKU still returns the complete 120-unit summary.
    const filtered = filterVariantInventorySummaries(summaries, { searchQuery: 'BANANA-50OB' })
    expect(filtered).toHaveLength(2)
    expect(filtered.every(summary => summary.onHand === 120)).toBe(true)

    const sorted = sortVariantInventorySummaries(filtered, 'incoming', 'desc')
    const page = paginateVariantInventorySummaries(sorted, 1, 1)
    const exported = buildInventorySummaryExportRows(page)
    expect(page).toHaveLength(1)
    expect(exported).toEqual([expect.objectContaining({
      organizationName: 'Warehouse Balakong',
      onHand: 120,
      incoming: 10_000,
      value: 1_680,
      updatedAt: '2026-07-18T03:00:00.000Z',
    })])
  })

  it('filters status and value ranges against summaries', () => {
    const [base] = aggregateVariantInventory(summaryBananaRows(), () => 0)
    const summaries = [
      { ...base, key: 'healthy', available: 120, reorderPoint: 20, value: 500 },
      { ...base, key: 'low', available: 10, reorderPoint: 20, value: 2_000 },
      { ...base, key: 'out', available: 0, reorderPoint: 20, value: 7_000 },
      { ...base, key: 'large', available: 200, reorderPoint: 20, value: 12_000 },
    ]

    expect(filterVariantInventorySummaries(summaries, { statusFilter: 'low_stock' }).map(row => row.key)).toEqual(['low'])
    expect(filterVariantInventorySummaries(summaries, { statusFilter: 'out_of_stock' }).map(row => row.key)).toEqual(['out'])
    expect(filterVariantInventorySummaries(summaries, { statusFilter: 'in_stock' })).toHaveLength(3)
    expect(filterVariantInventorySummaries(summaries, { valueRangeFilter: 'under_1000' }).map(row => row.key)).toEqual(['healthy'])
    expect(filterVariantInventorySummaries(summaries, { valueRangeFilter: '1000_5000' }).map(row => row.key)).toEqual(['low'])
    expect(filterVariantInventorySummaries(summaries, { valueRangeFilter: '5000_10000' }).map(row => row.key)).toEqual(['out'])
    expect(filterVariantInventorySummaries(summaries, { valueRangeFilter: 'over_10000' }).map(row => row.key)).toEqual(['large'])
  })

  it('never produces a negative value from a negative current balance', () => {
    const rows = summaryBananaRows()
    rows[3] = { ...rows[3], quantity_on_hand: -120, quantity_available: -120 }
    const [summary] = aggregateVariantInventory(rows, () => 0)

    expect(summary.value).toBe(1_680)
    expect(summary.configs.find(config => config.isLegacy)?.value).toBe(0)
  })
})

const UNIT_COST = 14

// Banana Milk at Warehouse Balakong after a successful Initial Configuration
// Classification: Legacy cleared to 0, balances split across three configs.
const bananaRows = (orgId = 'wh-balakong'): InventoryConfigRow[] => [
  {
    id: `${orgId}-20nb`, organization_id: orgId, organization_name: 'Warehouse Balakong',
    variant_id: 'banana', variant_code: 'BANANA', variant_name: 'Cellera [ Banana Milk ]',
    product_name: 'Cellera', product_code: 'CEL', stock_config_id: 'cfg-20nb', config_code: '20NB',
    stock_sku: 'SKU-BANANA-20NB', volume_ml: 20, packaging: 'new_box', default_for_ord: true,
    stock_config_status: 'active', quantity_on_hand: 50, quantity_allocated: 0, quantity_available: 50,
    unit_cost: UNIT_COST,
  },
  {
    id: `${orgId}-50nb`, organization_id: orgId, organization_name: 'Warehouse Balakong',
    variant_id: 'banana', variant_code: 'BANANA', variant_name: 'Cellera [ Banana Milk ]',
    product_name: 'Cellera', product_code: 'CEL', stock_config_id: 'cfg-50nb', config_code: '50NB',
    stock_sku: 'SKU-BANANA-50NB', volume_ml: 50, packaging: 'new_box', default_for_ord: false,
    stock_config_status: 'active', quantity_on_hand: 40, quantity_allocated: 0, quantity_available: 40,
    unit_cost: UNIT_COST,
  },
  {
    id: `${orgId}-50ob`, organization_id: orgId, organization_name: 'Warehouse Balakong',
    variant_id: 'banana', variant_code: 'BANANA', variant_name: 'Cellera [ Banana Milk ]',
    product_name: 'Cellera', product_code: 'CEL', stock_config_id: 'cfg-50ob', config_code: '50OB',
    stock_sku: 'SKU-BANANA-50OB', volume_ml: 50, packaging: 'old_box', default_for_ord: false,
    stock_config_status: 'phase_out', quantity_on_hand: 30, quantity_allocated: 0, quantity_available: 30,
    unit_cost: UNIT_COST,
  },
  {
    id: `${orgId}-legacy`, organization_id: orgId, organization_name: 'Warehouse Balakong',
    variant_id: 'banana', variant_code: 'BANANA', variant_name: 'Cellera [ Banana Milk ]',
    product_name: 'Cellera', product_code: 'CEL', stock_config_id: 'cfg-unc', config_code: 'UNCLASSIFIED',
    stock_sku: 'SKU-BANANA-UNC', volume_ml: null, packaging: null, default_for_ord: false,
    stock_config_status: 'phase_out', quantity_on_hand: 0, quantity_allocated: 0, quantity_available: 0,
    unit_cost: UNIT_COST,
  },
]

// Incoming 10,000 for the Banana variant at Balakong (variant-level total).
const incoming10k = (org: string | null | undefined, variant: string | null | undefined) =>
  org === 'wh-balakong' && variant === 'banana' ? 10_000 : 0

describe('aggregateVariantInventory', () => {
  it('collapses four balance rows into one summary per variant', () => {
    const summaries = aggregateVariantInventory(bananaRows(), incoming10k)
    expect(summaries).toHaveLength(1)
    const banana = summaries[0]
    expect(banana.onHand).toBe(120)
    expect(banana.allocated).toBe(0)
    expect(banana.available).toBe(120)
  })

  it('surfaces the variant incoming exactly once at the summary', () => {
    const [banana] = aggregateVariantInventory(bananaRows(), incoming10k)
    expect(banana.incoming).toBe(10_000)
    // Position = aggregate available + aggregate incoming
    expect(banana.position).toBe(10_120)
  })

  it('attributes incoming to 20NB only and never repeats it across configurations', () => {
    const [banana] = aggregateVariantInventory(bananaRows(), incoming10k, { includeInactive: true })
    const byCode = Object.fromEntries(banana.configs.map((c) => [c.configCode, c]))
    expect(byCode['20NB'].incoming).toBe(10_000)
    expect(byCode['50NB'].incoming).toBe(0)
    expect(byCode['50OB'].incoming).toBe(0)
    expect(byCode['UNCLASSIFIED'].incoming).toBe(0)
    // The variant incoming appears on exactly one configuration row.
    expect(banana.configs.filter((c) => c.incoming > 0)).toHaveLength(1)
    // Sum of configuration incoming equals the variant incoming — no join multiplication.
    expect(banana.configs.reduce((sum, c) => sum + c.incoming, 0)).toBe(10_000)
  })

  it('computes per-configuration position from that configuration only', () => {
    const [banana] = aggregateVariantInventory(bananaRows(), incoming10k, { includeInactive: true })
    const byCode = Object.fromEntries(banana.configs.map((c) => [c.configCode, c]))
    expect(byCode['20NB'].position).toBe(10_050) // 50 + 10,000
    expect(byCode['50NB'].position).toBe(40)
    expect(byCode['50OB'].position).toBe(30)
    expect(byCode['UNCLASSIFIED'].position).toBe(0)
  })

  it('keeps Total Value positive using current On Hand × unit cost', () => {
    const [banana] = aggregateVariantInventory(bananaRows(), incoming10k, { includeInactive: true })
    expect(banana.value).toBe(1_680) // 120 × RM14
    const byCode = Object.fromEntries(banana.configs.map((c) => [c.configCode, c]))
    expect(byCode['20NB'].value).toBe(700)
    expect(byCode['50NB'].value).toBe(560)
    expect(byCode['50OB'].value).toBe(420)
    expect(byCode['UNCLASSIFIED'].value).toBe(0)
    expect(banana.value).toBeGreaterThan(0)
  })

  it('never lets a classification-cleared Legacy balance drive value negative', () => {
    // Simulate the reported defect input: a stray outbound-only Legacy balance.
    const rows = bananaRows()
    rows[3] = { ...rows[3], quantity_on_hand: -100, quantity_available: -100 }
    const [banana] = aggregateVariantInventory(rows, incoming10k, { includeInactive: true })
    const legacy = banana.configs.find((c) => c.configCode === 'UNCLASSIFIED')!
    // Negative on-hand contributes 0 to value, never a negative RM figure.
    expect(legacy.value).toBe(0)
    expect(banana.value).toBeGreaterThanOrEqual(1_680)
  })

  it('hides the zero Legacy/Unclassified configuration by default', () => {
    const [banana] = aggregateVariantInventory(bananaRows(), incoming10k)
    expect(banana.configs.map((c) => c.configCode)).toEqual(['20NB', '50NB', '50OB'])
    expect(banana.hiddenConfigCount).toBe(1)
    // Summary totals still reflect the (zero) Legacy balance.
    expect(banana.onHand).toBe(120)
  })

  it('shows the Legacy configuration when includeInactive is set', () => {
    const [banana] = aggregateVariantInventory(bananaRows(), incoming10k, { includeInactive: true })
    expect(banana.configs.map((c) => c.configCode)).toContain('UNCLASSIFIED')
    expect(banana.hiddenConfigCount).toBe(0)
  })

  it('exposes SKU, volume, packaging, lifecycle and legacy labels on each configuration', () => {
    const [banana] = aggregateVariantInventory(bananaRows(), incoming10k, { includeInactive: true })
    const byCode = Object.fromEntries(banana.configs.map((c) => [c.configCode, c]))
    expect(byCode['20NB']).toMatchObject({
      stockSku: 'SKU-BANANA-20NB', volumeMl: 20, packaging: 'new_box',
      lifecycleStatus: 'active', label: '20ml · New Box', isLegacy: false,
    })
    expect(byCode['UNCLASSIFIED']).toMatchObject({ isLegacy: true, label: 'Legacy / Unclassified' })
  })

  it('produces one summary per flavour, not one per configuration', () => {
    const summaries = aggregateVariantInventory(bananaRows(), incoming10k)
    // A search for "Banana" resolves to a single summary row, not four.
    const matches = summaries.filter((s) => s.variantName?.includes('Banana'))
    expect(matches).toHaveLength(1)
  })

  it('keeps the same variant in another organization separate', () => {
    const rows = [...bananaRows('wh-balakong'), ...bananaRows('wh-shah-alam')]
    const summaries = aggregateVariantInventory(rows, incoming10k)
    expect(summaries).toHaveLength(2)
    const balakong = summaries.find((s) => s.organizationId === 'wh-balakong')!
    const shahAlam = summaries.find((s) => s.organizationId === 'wh-shah-alam')!
    expect(balakong.onHand).toBe(120)
    expect(shahAlam.onHand).toBe(120)
    // Incoming is scoped to Balakong; Shah Alam has none.
    expect(balakong.incoming).toBe(10_000)
    expect(shahAlam.incoming).toBe(0)
  })
})

describe('pickIncomingConfigRowId', () => {
  it('prefers the 20NB configuration', () => {
    expect(pickIncomingConfigRowId(bananaRows())).toBe('wh-balakong-20nb')
  })

  it('falls back to the ORD default when no 20NB exists', () => {
    const rows = bananaRows().filter((r) => r.config_code !== '20NB')
    rows[0] = { ...rows[0], default_for_ord: true }
    expect(pickIncomingConfigRowId(rows)).toBe(rows[0].id)
  })

  it('attributes incoming to the sole row of a non-configured variant', () => {
    const std: InventoryConfigRow = {
      id: 'std-1', organization_id: 'wh', variant_id: 'std', config_code: 'STD',
      stock_config_id: 'cfg-std', volume_ml: null, packaging: null, default_for_ord: false,
      quantity_on_hand: 10, quantity_allocated: 0, quantity_available: 10, unit_cost: 5,
    }
    expect(pickIncomingConfigRowId([std])).toBe('std-1')
  })

  it('does not attribute incoming when it cannot be pinned to one row', () => {
    const rows = bananaRows()
      .filter((r) => r.config_code !== '20NB')
      .map((r) => ({ ...r, default_for_ord: false }))
    expect(pickIncomingConfigRowId(rows)).toBeNull()
  })
})

describe('isLegacyConfigRow', () => {
  it('treats UNCLASSIFIED, missing config id, and dimensionless rows as legacy', () => {
    const [twentyNb, , , legacy] = bananaRows()
    expect(isLegacyConfigRow(twentyNb)).toBe(false)
    expect(isLegacyConfigRow(legacy)).toBe(true)
    expect(isLegacyConfigRow({ ...twentyNb, stock_config_id: null })).toBe(true)
  })
})
