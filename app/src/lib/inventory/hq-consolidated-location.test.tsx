import { describe, expect, it } from 'vitest'
import {
  HQ_ALL_WAREHOUSES_LABEL,
  HQ_CONSOLIDATED_LEGACY_NOTE,
  hqConsolidatedLocationValue,
  hqIdFromConsolidatedLocation,
  isHqConsolidatedLocation,
  remapRowsForHqConsolidatedView,
  resolveDefaultInventoryLocationId,
} from './hq-consolidated-location'

describe('HQ consolidated inventory location', () => {
  it('uses a synthetic display-only location key', () => {
    const value = hqConsolidatedLocationValue('hq-1')
    expect(isHqConsolidatedLocation(value)).toBe(true)
    expect(hqIdFromConsolidatedLocation(value)).toBe('hq-1')
    expect(isHqConsolidatedLocation('warehouse-uuid')).toBe(false)
  })

  it('aggregates only active HQ warehouse rows and excludes HQ/distributor rows', () => {
    const remapped = remapRowsForHqConsolidatedView(
      [
        { organization_id: 'wh-1', organization_name: 'Balakong', organization_code: 'WH001', qty: 5 },
        { organization_id: 'wh-2', organization_name: 'Alma', organization_code: 'WH002', qty: 7 },
        { organization_id: 'hq-1', organization_name: 'Serapod Technology', organization_code: 'SERA-HQ', qty: 99 },
        { organization_id: 'dist-wh', organization_name: 'Dist WH', organization_code: 'DWH', qty: 3 },
      ],
      ['wh-1', 'wh-2'],
      hqConsolidatedLocationValue('hq-1'),
    )

    expect(remapped).toHaveLength(2)
    expect(remapped.every((row) => row.organization_name === HQ_ALL_WAREHOUSES_LABEL)).toBe(true)
    expect(remapped.every((row) => row.organization_id === hqConsolidatedLocationValue('hq-1'))).toBe(true)
    expect(HQ_CONSOLIDATED_LEGACY_NOTE).toContain('Direct legacy inventory')
  })
})

describe('default View Inventory location', () => {
  const hq = {
    id: 'hq-1',
    org_type_code: 'HQ',
    is_active: true,
    default_warehouse_org_id: 'wh-balakong',
  }
  const balakong = { id: 'wh-balakong', org_type_code: 'WH', is_active: true, parent_org_id: 'hq-1' }
  const alma = { id: 'wh-alma', org_type_code: 'WH', is_active: true, parent_org_id: 'hq-1' }

  it("opens on the HQ's default fulfillment warehouse", () => {
    expect(resolveDefaultInventoryLocationId([hq, balakong, alma])).toBe('wh-balakong')
  })

  it('stays on All Locations when no HQ names a default warehouse', () => {
    expect(resolveDefaultInventoryLocationId([
      { ...hq, default_warehouse_org_id: null },
      balakong,
    ])).toBeNull()
    expect(resolveDefaultInventoryLocationId([])).toBeNull()
  })

  it('ignores a default that is not an active warehouse in the list', () => {
    expect(resolveDefaultInventoryLocationId([hq, alma])).toBeNull()
    expect(resolveDefaultInventoryLocationId([hq, { ...balakong, is_active: false }])).toBeNull()
  })
})
