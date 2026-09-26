export interface WarehouseShipmentActor {
  id: string
  organization_id: string | null
  is_active: boolean | null
  role_level: number | null
  organization_type: string | null
}

export interface WarehouseShipmentScope {
  warehouse_org_id: string | null
  company_id: string | null
}

export type WarehouseShipmentAuthorization =
  | { allowed: true }
  | { allowed: false; reason: string }

export function authorizeWarehouseShipment(
  actor: WarehouseShipmentActor,
  shipment: WarehouseShipmentScope,
): WarehouseShipmentAuthorization {
  if (!actor.is_active) {
    return { allowed: false, reason: 'Inactive users cannot confirm shipments' }
  }

  if (!actor.organization_id || !shipment.warehouse_org_id) {
    return { allowed: false, reason: 'Warehouse scope is missing' }
  }

  if (actor.role_level == null || actor.role_level > 40) {
    return { allowed: false, reason: 'Warehouse shipping permission is required' }
  }

  const organizationType = String(actor.organization_type || '').toUpperCase()
  if (organizationType === 'WH' || organizationType === 'WAREHOUSE') {
    return actor.organization_id === shipment.warehouse_org_id
      ? { allowed: true }
      : { allowed: false, reason: 'Shipment belongs to another warehouse' }
  }

  if (organizationType === 'HQ') {
    const sameCompany = Boolean(
      shipment.company_id && actor.organization_id === shipment.company_id,
    )
    return sameCompany || actor.organization_id === shipment.warehouse_org_id
      ? { allowed: true }
      : { allowed: false, reason: 'Shipment belongs to another organization' }
  }

  return { allowed: false, reason: 'Only authorized HQ or warehouse users may confirm shipments' }
}
