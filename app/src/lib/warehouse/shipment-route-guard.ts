import { authorizeWarehouseShipment, type WarehouseShipmentScope } from './shipment-authorization'

// Minimal structural type so routes can pass either a typed or untyped admin client.
type AdminClient = { from: (table: string) => any }

export type ShipmentGuardResult =
  | { allowed: true }
  | { allowed: false; status: 403 | 404; message: string }

/**
 * Applies the Phase 0A warehouse shipment rule to the verified session actor.
 * The actor id must come from supabase.auth.getUser(), never from the request body.
 */
export async function authorizeShipmentActor(
  admin: AdminClient,
  actorUserId: string,
  scope: WarehouseShipmentScope,
): Promise<ShipmentGuardResult> {
  const { data: actorProfile, error } = await admin
    .from('users')
    .select(`
      id,
      organization_id,
      is_active,
      roles:role_code(role_level),
      organizations!fk_users_organization(org_type_code)
    `)
    .eq('id', actorUserId)
    .single()

  if (error || !actorProfile) {
    return { allowed: false, status: 403, message: 'Forbidden' }
  }

  const actorRole = Array.isArray(actorProfile.roles) ? actorProfile.roles[0] : actorProfile.roles
  const actorOrganization = Array.isArray(actorProfile.organizations)
    ? actorProfile.organizations[0]
    : actorProfile.organizations

  const decision = authorizeWarehouseShipment(
    {
      id: actorUserId,
      organization_id: actorProfile.organization_id ?? null,
      is_active: actorProfile.is_active ?? false,
      role_level: actorRole?.role_level ?? null,
      organization_type: actorOrganization?.org_type_code ?? null,
    },
    scope,
  )

  return decision.allowed ? { allowed: true } : { allowed: false, status: 403, message: decision.reason }
}

/**
 * Loads the shipment session scope with the admin client and authorizes the actor for it.
 */
export async function authorizeShipmentSessionActor(
  admin: AdminClient,
  actorUserId: string,
  sessionId: string,
): Promise<ShipmentGuardResult> {
  const { data: session, error } = await admin
    .from('qr_validation_reports')
    .select('id, warehouse_org_id, company_id')
    .eq('id', sessionId)
    .single()

  if (error || !session) {
    return { allowed: false, status: 404, message: 'Shipment session not found' }
  }

  return authorizeShipmentActor(admin, actorUserId, {
    warehouse_org_id: session.warehouse_org_id ?? null,
    company_id: session.company_id ?? null,
  })
}
