export interface FulfillmentDefaultOrgLike {
  id: string
  org_name: string
  org_type_code: string
  parent_org_id?: string | null
  is_active?: boolean | null
}

/**
 * The Distributor Order Fulfillment card is only for active warehouses whose
 * direct parent is an HQ. It is never shown for HQ/DIST/SHOP/MFG or for
 * warehouses under a distributor.
 */
export function shouldShowDistributorFulfillmentCard(
  organization: FulfillmentDefaultOrgLike | null | undefined,
  parentOrganization: FulfillmentDefaultOrgLike | null | undefined,
): boolean {
  if (!organization || !parentOrganization) return false
  if (organization.org_type_code !== 'WH') return false
  if (organization.is_active !== true) return false
  if (parentOrganization.org_type_code !== 'HQ') return false
  if (organization.parent_org_id !== parentOrganization.id) return false
  return true
}

export function buildSetDefaultFulfillmentConfirmMessage(
  warehouseName: string,
  hqName: string,
) {
  return `Set ${warehouseName} as the default fulfillment warehouse?\n\nNew distributor orders under ${hqName} will automatically select this warehouse. Existing orders will not be changed.`
}
