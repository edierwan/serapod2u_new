import { describe, expect, it } from 'vitest'
import {
  HQ_ALL_WAREHOUSES_LABEL,
  HQ_CONSOLIDATED_LEGACY_NOTE,
  hqConsolidatedLocationValue,
  hqIdFromConsolidatedLocation,
  isHqConsolidatedLocation,
  remapRowsForHqConsolidatedView,
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
