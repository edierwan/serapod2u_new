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

export interface InventoryLocationOrgRow extends LocationOrgRow {
  org_name?: string | null
  org_code?: string | null
  parent_org_id?: string | null
}

export interface InventoryLocationOption {
  id: string
  org_name: string
  org_code: string | null
  is_consolidated: boolean
}

export interface InventoryLocationScope {
  /** Dropdown entries: real HQ/warehouse organizations plus the synthetic consolidated option(s). */
  locations: InventoryLocationOption[]
  /** Warehouse ids grouped by their parent HQ, for the consolidated filter scope. */
  warehouseIdsByHq: Map<string, string[]>
  /** Real organization ids this page is allowed to show — what "All Locations" means. */
  allowedLocationIds: Set<string>
  /** The HQ's default fulfillment warehouse, or null to stay on "All Locations". */
  defaultLocationId: string | null
}

/**
 * Single source of truth for the inventory Location filter, shared by View
 * Inventory and Inventory Settings so the two cannot drift apart again.
 *
 * Eligibility is entirely data-driven — organization type plus the HQ/warehouse
 * parent relationship — so no organization name or id is ever hardcoded.
 * Distributors, shops and manufacturers are excluded because they are neither
 * `HQ` nor `WH`.
 *
 * `hqScopeOnly` narrows the scope further to the HQ warehouse network: HQ
 * organizations plus warehouses whose direct parent is an HQ, matching
 * `filterEligibleHqFulfillmentWarehouses`. Inventory Settings is an HQ
 * administration page and uses it; View Inventory also serves warehouse and
 * distributor operators, so it keeps the wider active HQ/WH list.
 */
export function buildInventoryLocationScope(
  rows: InventoryLocationOrgRow[],
  { hqScopeOnly = false }: { hqScopeOnly?: boolean } = {},
): InventoryLocationScope {
  const eligible = rows.filter(
    (row) =>
      row.is_active !== false && (row.org_type_code === 'HQ' || row.org_type_code === 'WH'),
  )
  const hqIds = new Set(eligible.filter((row) => row.org_type_code === 'HQ').map((row) => row.id))

  const warehouseIdsByHq = new Map<string, string[]>()
  for (const warehouse of eligible) {
    if (warehouse.org_type_code !== 'WH') continue
    const parentId = warehouse.parent_org_id
    if (!parentId || !hqIds.has(parentId)) continue
    const current = warehouseIdsByHq.get(parentId) || []
    current.push(warehouse.id)
    warehouseIdsByHq.set(parentId, current)
  }

  const scoped = hqScopeOnly
    ? eligible.filter(
      (row) =>
        row.org_type_code === 'HQ' || Boolean(row.parent_org_id && hqIds.has(row.parent_org_id)),
    )
    : eligible

  const consolidatedOptions: InventoryLocationOption[] = eligible
    .filter((row) => row.org_type_code === 'HQ' && (warehouseIdsByHq.get(row.id) || []).length > 0)
    .map((hq) => ({
      id: hqConsolidatedLocationValue(hq.id),
      org_name: HQ_ALL_WAREHOUSES_LABEL,
      org_code: 'HQ-ALL-WH',
      is_consolidated: true,
    }))

  return {
    locations: [
      ...scoped.map((row) => ({
        id: row.id,
        org_name: row.org_name || 'Unknown Location',
        org_code: row.org_code ?? null,
        is_consolidated: false,
      })),
      ...consolidatedOptions,
    ],
    warehouseIdsByHq,
    allowedLocationIds: new Set(scoped.map((row) => row.id)),
    defaultLocationId: resolveDefaultInventoryLocationId(rows),
  }
}

/**
 * Rows visible for the current Location selection, WITHOUT merging anything.
 *
 * Inventory Settings edits one `product_inventory` record per row, so the
 * consolidated option is only a filter scope here: it widens the selection to
 * every warehouse in the HQ set while each row keeps its own id, its own real
 * warehouse and its own quantities. "All Locations" means the allowed HQ /
 * warehouse scope only, never every organization in the database.
 */
export function filterRowsByInventoryLocation<T extends { organization_id?: string | null }>(
  rows: T[],
  locationFilter: string,
  scope: Pick<InventoryLocationScope, 'warehouseIdsByHq' | 'allowedLocationIds'>,
): T[] {
  if (isHqConsolidatedLocation(locationFilter)) {
    const warehouseIds = new Set(
      scope.warehouseIdsByHq.get(hqIdFromConsolidatedLocation(locationFilter)) || [],
    )
    return rows.filter((row) => row.organization_id && warehouseIds.has(row.organization_id))
  }

  if (locationFilter === 'all') {
    return rows.filter((row) => row.organization_id && scope.allowedLocationIds.has(row.organization_id))
  }

  return rows.filter((row) => row.organization_id === locationFilter)
}
