import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  buildInventoryLocationScope,
  filterRowsByInventoryLocation,
  hqConsolidatedLocationValue,
} from './hq-consolidated-location'
import { variantIdentityLabel } from './variant-display-label'

const repoFile = (path: string) => fs.readFileSync(
  new URL(`../../../../${path}`, import.meta.url),
  'utf8',
)
const settingsView = repoFile('app/src/components/inventory/InventorySettingsView.tsx')
const inventoryView = repoFile('app/src/components/inventory/InventoryView.tsx')
const supplyChainNav = repoFile('app/src/modules/supply-chain/supplyChainNav.ts')
const dashboardContent = repoFile('app/src/components/dashboard/DashboardContent.tsx')

/* ------------------------------------------------------------------ Issue 1 */

describe('Inventory Settings — Product / Variant identity line', () => {
  it('renders the flavour plus the variant Product Code', () => {
    expect(variantIdentityLabel('Fruity Cellera Cartridge [ Lychee Blackcurrant ]', 'LB'))
      .toBe('Lychee Blackcurrant – LB')
  })

  it('shows the flavour alone when the variant Product Code is blank, never the variant_code', () => {
    for (const missing of [null, undefined, '', '   ']) {
      const label = variantIdentityLabel('Fruity Cellera Cartridge [ Lychee Blackcurrant ]', missing)
      expect(label).toBe('Lychee Blackcurrant')
      expect(label).not.toContain('FRU-620900')
    }
  })

  it('reuses the shared helper and selects product_variants.product_code', () => {
    expect(settingsView).toContain("import { variantIdentityLabel } from '@/lib/inventory/variant-display-label'")
    expect(settingsView).toContain('variantIdentityLabel(item.variant_name, item.variant_product_code)')
    expect(settingsView).toContain('variant_product_code: variant?.product_code || null')
    // No duplicated bracket-extraction logic inside the page component.
    expect(settingsView).not.toMatch(/\\\[\(\[\^\[\\\]\]\*\)\\\]/)
    // The old long line is gone.
    expect(settingsView).not.toContain('{item.variant_code} • {item.variant_name}')
  })
})

/* ------------------------------------------------------------------ Issue 2 */

describe('Inventory Settings — bulk-enable block removed', () => {
  it('no longer imports or renders BulkEnableStockConfigurationsPanel', () => {
    expect(settingsView).not.toContain('BulkEnableStockConfigurationsPanel')
  })

  it('keeps the dormant panel and its concentration eligibility guards in the repository', () => {
    expect(() => repoFile('app/src/components/products/BulkEnableStockConfigurationsPanel.tsx')).not.toThrow()
    expect(() => repoFile('app/src/lib/inventory/concentration-stock-eligibility.ts')).not.toThrow()
    expect(() => repoFile('app/src/app/api/inventory/stock-configurations/bulk-enable/route.ts')).not.toThrow()
  })
})

/* ------------------------------------------------------------------ Issue 3 */

const hq = {
  id: 'hq-1',
  org_name: 'Serapod Technology Sdn Bhd',
  org_code: 'SERA-HQ',
  org_type_code: 'HQ',
  is_active: true,
  parent_org_id: null,
  default_warehouse_org_id: 'wh-balakong',
}
const alma = {
  id: 'wh-alma',
  org_name: 'Serapod Warehouse Alma',
  org_code: 'WH-ALMA',
  org_type_code: 'WH',
  is_active: true,
  parent_org_id: 'hq-1',
  default_warehouse_org_id: null,
}
const balakong = {
  id: 'wh-balakong',
  org_name: 'Serapod Warehouse Balakong',
  org_code: 'WH-BLK',
  org_type_code: 'WH',
  is_active: true,
  parent_org_id: 'hq-1',
  default_warehouse_org_id: null,
}
const distributor = {
  id: 'dist-1',
  org_name: 'Mateen Trading Distribution Sdn Bhd',
  org_code: 'DIST-MTN',
  org_type_code: 'DIST',
  is_active: true,
  parent_org_id: 'hq-1',
  default_warehouse_org_id: null,
}
const shop = {
  id: 'shop-1',
  org_name: 'Popular Vape',
  org_code: 'SHOP-PV',
  org_type_code: 'SHOP',
  is_active: true,
  parent_org_id: 'dist-1',
  default_warehouse_org_id: null,
}
const manufacturer = {
  id: 'mfg-1',
  org_name: 'Infy Tech Manufacturing',
  org_code: 'MFG-INFY',
  org_type_code: 'MFG',
  is_active: true,
  parent_org_id: null,
  default_warehouse_org_id: null,
}
/** A warehouse owned by a distributor — outside the HQ warehouse network. */
const distributorWarehouse = {
  id: 'dist-wh',
  org_name: 'Maxvaper Warehouse',
  org_code: 'DWH',
  org_type_code: 'WH',
  is_active: true,
  parent_org_id: 'dist-1',
  default_warehouse_org_id: null,
}
const retiredWarehouse = { ...alma, id: 'wh-retired', org_name: 'Retired WH', is_active: false }

const allOrgs = [hq, alma, balakong, distributor, shop, manufacturer, distributorWarehouse, retiredWarehouse]

describe('Inventory Settings — HQ location scope', () => {
  const scope = buildInventoryLocationScope(allOrgs, { hqScopeOnly: true })
  const names = scope.locations.map((location) => location.org_name)

  it('offers only the HQ, its active warehouses and the consolidated option', () => {
    expect(names).toEqual([
      'Serapod Technology Sdn Bhd',
      'Serapod Warehouse Alma',
      'Serapod Warehouse Balakong',
      'All Serapod HQ Warehouses',
    ])
    expect(scope.locations.filter((location) => location.is_consolidated)).toHaveLength(1)
  })

  it('excludes distributors, shops, manufacturers and distributor-owned warehouses', () => {
    for (const excluded of [distributor, shop, manufacturer, distributorWarehouse, retiredWarehouse]) {
      expect(names).not.toContain(excluded.org_name)
      expect(scope.allowedLocationIds.has(excluded.id)).toBe(false)
    }
  })

  it('resolves the default location from organizations.default_warehouse_org_id', () => {
    expect(scope.defaultLocationId).toBe('wh-balakong')
    expect(
      buildInventoryLocationScope(
        [{ ...hq, default_warehouse_org_id: null }, alma, balakong],
        { hqScopeOnly: true },
      ).defaultLocationId,
    ).toBeNull()
  })

  it('keeps View Inventory on the wider active HQ/WH list', () => {
    const viewScope = buildInventoryLocationScope(allOrgs)
    expect(viewScope.locations.map((location) => location.id)).toContain('dist-wh')
    expect(viewScope.locations.map((location) => location.id)).not.toContain('shop-1')
    expect(viewScope.defaultLocationId).toBe('wh-balakong')
  })
})

describe('Inventory Settings — location filtering keeps rows editable', () => {
  const scope = buildInventoryLocationScope(allOrgs, { hqScopeOnly: true })
  const rows = [
    { id: 'inv-1', organization_id: 'wh-alma', quantity_available: 10 },
    { id: 'inv-2', organization_id: 'wh-balakong', quantity_available: 25 },
    { id: 'inv-3', organization_id: 'hq-1', quantity_available: 4 },
    { id: 'inv-4', organization_id: 'dist-1', quantity_available: 999 },
    { id: 'inv-5', organization_id: 'dist-wh', quantity_available: 888 },
  ]

  it('filters a single location by organization id, not by organization name', () => {
    expect(filterRowsByInventoryLocation(rows, 'wh-balakong', scope).map((row) => row.id))
      .toEqual(['inv-2'])
  })

  it('limits All Locations to the allowed HQ scope so distributor stock never leaks back', () => {
    expect(filterRowsByInventoryLocation(rows, 'all', scope).map((row) => row.id))
      .toEqual(['inv-1', 'inv-2', 'inv-3'])
  })

  it('treats the consolidated option as a filter scope and never merges editable rows', () => {
    const consolidated = filterRowsByInventoryLocation(
      rows,
      hqConsolidatedLocationValue('hq-1'),
      scope,
    )
    expect(consolidated.map((row) => row.id)).toEqual(['inv-1', 'inv-2'])
    // Each underlying product_inventory record keeps its id, its real warehouse
    // and its own quantity — nothing is summed and no synthetic org id is written.
    expect(consolidated.map((row) => row.organization_id)).toEqual(['wh-alma', 'wh-balakong'])
    expect(consolidated.map((row) => row.quantity_available)).toEqual([10, 25])
    expect(consolidated.some((row) => String(row.organization_id).startsWith('hq-all-warehouses:')))
      .toBe(false)
  })
})

describe('Inventory Settings — shares the View Inventory location source of truth', () => {
  it('both pages build their Location filter from buildInventoryLocationScope', () => {
    expect(settingsView).toContain('buildInventoryLocationScope')
    expect(inventoryView).toContain('buildInventoryLocationScope')
  })

  it('the settings page queries HQ/WH organizations by type, never by name', () => {
    expect(settingsView).toContain("in('org_type_code', ['WH', 'HQ'])")
    expect(settingsView).toContain('filterRowsByInventoryLocation')
    expect(settingsView).not.toContain('item.organization_name === locationFilter')
  })
})

/* ------------------------------------------------------------------ Issue 4 */

describe('Repack Stock removal', () => {
  it('is gone from the Supply Chain Inventory navigation and route maps', () => {
    expect(supplyChainNav).not.toContain('repack-stock')
    expect(supplyChainNav).not.toContain('inventory/repack')
  })

  it('leaves the Inventory group with the six remaining pages', () => {
    const inventoryGroup = supplyChainNav.slice(
      supplyChainNav.indexOf("id: 'sc-inventory'"),
      supplyChainNav.indexOf("id: 'sc-quality'"),
    )
    expect([...inventoryGroup.matchAll(/label: '([^']+)', icon/g)].map((match) => match[1])).toEqual([
      'View Inventory',
      'Inventory Settings',
      'Add Stock',
      'Stock Adjustment',
      'Stock Transfer',
      'Movement Reports',
    ])
  })

  it('has no render path left in DashboardContent', () => {
    expect(dashboardContent).not.toContain('RepackStockView')
    expect(dashboardContent).not.toContain("case 'repack-stock'")
  })

  it('deletes the page component and its page-only helper', () => {
    expect(() => repoFile('app/src/components/inventory/RepackStockView.tsx')).toThrow()
    expect(() => repoFile('app/src/lib/inventory/repack-stock.ts')).toThrow()
  })

  it('preserves the historical repack database and audit infrastructure', () => {
    // Migrations and movement history keep repack_in / repack_out intact.
    expect(() => repoFile('supabase/migrations/20260717_stock_config_03_ord_repack.sql')).not.toThrow()
    expect(() => repoFile('supabase/migrations/20260718_stock_config_10_repack_to_20nb.sql')).not.toThrow()
    const activity = repoFile('app/src/lib/inventory/opening-balance-activity-presentation.ts')
    expect(activity).toContain('repack_out')
    expect(activity).toContain('repack_in')
    expect(repoFile('app/src/components/inventory/StockMovementReportView.tsx')).toContain('repack_out')
  })
})
