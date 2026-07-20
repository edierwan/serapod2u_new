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
