export const DEFAULT_DISTRIBUTOR_FULFILLMENT_WAREHOUSE_SETTING_KEY =
  'default_distributor_fulfillment_warehouse_id'

/** Existing FK-backed HQ setting that stores the default D2H fulfillment warehouse. */
export const DEFAULT_FULFILLMENT_WAREHOUSE_COLUMN = 'default_warehouse_org_id'

export const MISSING_DEFAULT_FULFILLMENT_WAREHOUSE_MESSAGE =
  'No default fulfillment warehouse is configured. Select a warehouse before submitting this order.'

/**
 * Why a line cannot be fulfilled from the chosen warehouse.
 *
 * When the shortfall is caused by reservations rather than by empty shelves,
 * the message says so: submitted D2H/S2D orders hold their quantity until they
 * are approved or cancelled, so a flavour with 10,514 cases on hand can still
 * refuse a 100-case line. Quoting only the available figure made that read as
 * a system fault. `stock` is optional — callers that cannot resolve the split
 * still get the original copy.
 */
export function insufficientStockAtWarehouseMessage(
  warehouseName: string,
  stock?: { available: number; onHand: number; reserved: number },
) {
  const reserved = stock && stock.reserved > 0
    ? ` ${stock.available.toLocaleString()} of ${stock.onHand.toLocaleString()} cases are free — ${stock.reserved.toLocaleString()} are reserved by submitted orders awaiting approval.`
    : ''
  return `Insufficient available stock at ${warehouseName}.${reserved} Select another fulfillment warehouse or adjust the order quantity.`
}

export interface HqFulfillmentWarehouse {
  id: string
  org_name: string
  org_code: string
  org_type_code: string
  parent_org_id: string | null
  is_active: boolean
}

export function resolveSellerHqId(org: {
  id: string
  org_type_code: string
  parent_org_id?: string | null
}): string | null {
  if (org.org_type_code === 'HQ') return org.id
  if (org.org_type_code === 'WH') return org.parent_org_id || null
  return null
}

/**
 * Eligible D2H fulfillment warehouses: active WH orgs whose direct parent is the
 * seller HQ. Excludes the HQ itself, distributors, shops, manufacturers, and
 * warehouses under other parents.
 */
export function filterEligibleHqFulfillmentWarehouses<T extends HqFulfillmentWarehouse>(
  warehouses: T[],
  hqOrgId: string,
): T[] {
  return warehouses
    .filter((warehouse) =>
      warehouse.org_type_code === 'WH'
      && warehouse.is_active === true
      && warehouse.parent_org_id === hqOrgId
    )
    .sort((a, b) => a.org_name.localeCompare(b.org_name))
}

export function resolveDefaultFulfillmentWarehouseId(
  defaultWarehouseId: string | null | undefined,
  eligibleWarehouses: Array<{ id: string }>,
): { warehouseId: string | null; defaultMissingOrInvalid: boolean } {
  if (!defaultWarehouseId) {
    return { warehouseId: null, defaultMissingOrInvalid: true }
  }
  if (!eligibleWarehouses.some((warehouse) => warehouse.id === defaultWarehouseId)) {
    return { warehouseId: null, defaultMissingOrInvalid: true }
  }
  return { warehouseId: defaultWarehouseId, defaultMissingOrInvalid: false }
}

export async function loadActiveHqFulfillmentWarehouses(
  admin: any,
  hqOrgId: string,
  select = 'id, org_name, org_code, org_type_code, parent_org_id, is_active',
): Promise<{ data: HqFulfillmentWarehouse[]; error: { message: string } | null }> {
  const { data, error } = await admin
    .from('organizations')
    .select(select)
    .eq('org_type_code', 'WH')
    .eq('is_active', true)
    .eq('parent_org_id', hqOrgId)
    .order('org_name', { ascending: true })

  if (error) return { data: [], error }
  return {
    data: filterEligibleHqFulfillmentWarehouses((data || []) as HqFulfillmentWarehouse[], hqOrgId),
    error: null,
  }
}
