import { NextResponse } from 'next/server'
import { requireSelfServiceActor } from '@/lib/security-access/admin-api'

export const dynamic = 'force-dynamic'

/**
 * GET /api/security-access/me/request-options
 *
 * What the caller may ask for in a self-service access request: their active
 * business memberships, the scopes inside those organizations, the requestable
 * business roles (active, never legacy compatibility roles or the employee
 * baseline) and the roles they already hold. Read-only; submitting and
 * deciding are re-checked by sa_submit_access_request / sa_decide_access_request.
 */
export async function GET() {
  const actor = await requireSelfServiceActor()
  if (actor instanceof NextResponse) return actor
  const admin = actor.admin
  const { data: memberships, error } = await admin.from('sa_organization_memberships')
    .select('id, organization_id, organization:organizations(org_name), assignments:sa_role_assignments!sa_role_assignments_membership_id_fkey(role_id, status, effective_until)')
    .eq('user_id', actor.userId).eq('status', 'active')
  if (error) return NextResponse.json({ error: 'Unable to load request options' }, { status: 500 })
  const orgIds = (memberships || []).map((m: any) => m.organization_id)
  const [{ data: scopes }, { data: roles }] = await Promise.all([
    orgIds.length
      ? admin.from('sa_scope_definitions').select('id, organization_id, scope_type, display_name')
        .in('organization_id', orgIds).eq('status', 'active').neq('scope_type', 'own_record').order('display_name')
      : Promise.resolve({ data: [] }),
    admin.from('sa_business_roles').select('id, name, description')
      .eq('status', 'active').neq('source', 'legacy').neq('role_key', 'employee-self-service').order('name'),
  ])
  const now = Date.now()
  return NextResponse.json({
    memberships: (memberships || []).map((m: any) => ({
      organizationId: m.organization_id,
      organizationName: (Array.isArray(m.organization) ? m.organization[0] : m.organization)?.org_name ?? 'Organization',
      heldRoleIds: (m.assignments || [])
        .filter((a: any) => a.status === 'active' && !(a.effective_until && new Date(a.effective_until).getTime() <= now))
        .map((a: any) => a.role_id),
    })),
    scopes: scopes || [],
    roles: roles || [],
  })
}
