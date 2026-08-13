export const HQ_ALL_WAREHOUSES_LOCATION_PREFIX = 'hq-all-warehouses:'
export const HQ_ALL_WAREHOUSES_LABEL = 'All Serapod HQ Warehouses'
export const HQ_CONSOLIDATED_LEGACY_NOTE =
  'Consolidated total includes warehouse locations only. Direct legacy inventory recorded under the HQ organization is not included.'

export function isHqConsolidatedLocation(locationFilter: string) {
  return locationFilter.startsWith(HQ_ALL_WAREHOUSES_LOCATION_PREFIX)
}

export function hqConsolidatedLocationValue(hqOrgId: string) {
  return `${HQ_ALL_WAREHOUSES_LOCATION_PREFIX}${hqOrgId}`
}

export function hqIdFromConsolidatedLocation(locationFilter: string) {
  return locationFilter.slice(HQ_ALL_WAREHOUSES_LOCATION_PREFIX.length)
}

export interface LocationOrgRow {
  id: string
  org_type_code?: string | null
  is_active?: boolean | null
  default_warehouse_org_id?: string | null
}

/**
 * The Location filter opens on the HQ's default fulfillment warehouse rather
 * than "All Locations": operators work one warehouse at a time, and the
 * unfiltered view mixes distributor and shop balances into the headline KPIs.
 *
 * The default is data-driven — organizations.default_warehouse_org_id on the HQ,
 * the same source of truth the Distributor Order Fulfillment card writes — so no
 * warehouse name is hardcoded. Returns null when no HQ names an active
 * warehouse, leaving the filter on "All Locations".
 */
export function resolveDefaultInventoryLocationId(rows: LocationOrgRow[]): string | null {
  const activeWarehouseIds = new Set(
    rows.filter((row) => row.org_type_code === 'WH' && row.is_active !== false).map((row) => row.id),
  )

  for (const row of rows) {
    if (row.org_type_code !== 'HQ') continue
    const defaultWarehouseId = row.default_warehouse_org_id
    if (defaultWarehouseId && activeWarehouseIds.has(defaultWarehouseId)) {
      return defaultWarehouseId
    }
  }

  return null
}

/** Remap warehouse rows into one synthetic consolidated location for display-only totals. */
export function remapRowsForHqConsolidatedView<T extends {
  organization_id?: string | null
  organization_name?: string | null
  organization_code?: string | null
}>(
  rows: T[],
  warehouseIds: string[],
  consolidatedLocationValue: string,
): T[] {
  const allowed = new Set(warehouseIds)
  return rows
    .filter((row) => row.organization_id && allowed.has(row.organization_id))
    .map((row) => ({
      ...row,
      organization_id: consolidatedLocationValue,
      organization_name: HQ_ALL_WAREHOUSES_LABEL,
      organization_code: 'HQ-ALL-WH',
    }))
}
