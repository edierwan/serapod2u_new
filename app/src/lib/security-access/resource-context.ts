import { createAdminClient } from '@/lib/supabase/admin'

const MAX_ANCESTRY_DEPTH = 8

/**
 * Organization context for a warehouse-owned resource (e.g. a Stock Count).
 *
 * `ancestry` is [warehouse, parent, grandparent, ...]. The actor's own
 * organization is used only when it lies on that chain, mirroring the
 * descendant rule of public.can_access_org. Otherwise the resource is
 * attributed to its owning root organization, so an actor from another
 * organization (another tenant, a distributor, a sibling warehouse) is
 * evaluated against an organization they have no membership in and the new
 * engine denies. Using the actor's organization unconditionally would let any
 * organization-scoped assignment match every warehouse.
 */
export function organizationContextForWarehouse(
  actorOrganizationId: string | null | undefined,
  ancestry: string[],
  warehouseId: string,
): string {
  if (actorOrganizationId && ancestry.includes(actorOrganizationId)) return actorOrganizationId
  return ancestry[ancestry.length - 1] ?? warehouseId
}

async function loadOrganizationAncestry(organizationId: string): Promise<string[]> {
  const admin = createAdminClient() as any
  const chain: string[] = []
  let current: string | null = organizationId
  while (current && chain.length < MAX_ANCESTRY_DEPTH && !chain.includes(current)) {
    const { data, error }: { data: { id: string; parent_org_id: string | null } | null; error: unknown } = await admin
      .from('organizations').select('id,parent_org_id').eq('id', current).maybeSingle()
    if (error) throw new Error('organization_context_unavailable')
    if (!data) break
    chain.push(data.id)
    current = data.parent_org_id
  }
  return chain
}

export async function resolveWarehouseResourceContext(actorOrganizationId: string | null | undefined, warehouseId: string) {
  const ancestry = await loadOrganizationAncestry(warehouseId)
  return { organizationId: organizationContextForWarehouse(actorOrganizationId, ancestry, warehouseId), warehouseId }
}
