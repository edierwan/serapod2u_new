import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { checkPermissionForUser } from '@/lib/server/permissions'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await checkPermissionForUser(user.id, 'manage_authorization')).allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = createAdminClient() as any
  try {
    const results = await Promise.all([
      admin.from('sa_organization_memberships').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      admin.from('sa_role_assignments').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      admin.from('sa_migration_modes').select('permission_key,mode,legacy_permission_key').order('permission_key'),
      admin.from('sa_authorization_decisions').select('id,occurred_at,actor_id,permission_key,resource_type,resource_id,decision,reason_code,migration_mode,legacy_decision,new_decision,comparison,correlation_id,policy_version').neq('comparison', 'MATCH_ALLOW').order('occurred_at', { ascending: false }).limit(100),
      admin.from('sa_permissions').select('id,permission_key,module,resource,action,description,status,source').order('permission_key'),
      admin.from('sa_business_roles').select('id,role_key,name,description,status,source,version,permissions:sa_business_role_permissions(permission:sa_permissions(permission_key))').order('name'),
      admin.from('users').select('id,full_name,email,organization_id,role_code,is_active,organization:organizations!fk_users_organization(org_name),membership:sa_organization_memberships!sa_organization_memberships_user_id_fkey(id,status,is_primary,membership_type,organization_id,assignments:sa_role_assignments!sa_role_assignments_membership_id_fkey(id,status,effective_from,effective_until,role:sa_business_roles(role_key,name),scopes:sa_assignment_scopes(scope:sa_scope_definitions(scope_type,scope_value,display_name))))').eq('organization_id', (await checkPermissionForUser(user.id, 'manage_authorization')).context?.organization_id).limit(200),
    ])
    if (results.some((result: any) => result.error)) {
      return NextResponse.json({ schemaReady: false, error: 'Wave 1 schema has not been applied in this environment.', metrics: {}, modes: [], decisions: [], permissions: [], roles: [], people: [] })
    }
    const [{ count: memberships }, { count: assignments }, { data: modes }, { data: decisions }, { data: permissions }, { data: roles }, { data: people }] = results
    return NextResponse.json({ schemaReady: true, metrics: { businessIdentities: memberships || 0, activeAssignments: assignments || 0, shadowMismatches: (decisions || []).filter((d: any) => !['MATCH_ALLOW','MATCH_DENY'].includes(d.comparison)).length }, modes: modes || [], decisions: decisions || [], permissions: permissions || [], roles: roles || [], people: people || [] })
  } catch (error) {
    return NextResponse.json({ schemaReady: false, error: 'Wave 1 schema has not been applied in this environment.', metrics: {}, modes: [], decisions: [], permissions: [], roles: [], people: [] })
  }
}
