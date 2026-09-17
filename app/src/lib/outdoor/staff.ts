import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function requireOutdoorStaff() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) return null

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('users')
    .select('id, organization_id, organizations!fk_users_organization(id, org_type_code), roles(role_level, role_code)')
    .eq('id', user.id)
    .single()

  if (!profile) return null
  const orgType = (profile.organizations as any)?.org_type_code
  const role = (profile.roles as any) || {}
  const roleLevel = Number(role.role_level ?? 99)
  const roleCode = String(role.role_code || '').toLowerCase()
  const allowed =
    orgType === 'HQ' &&
    (roleLevel <= 30 || ['super_admin', 'admin', 'org_admin', 'warehouse', 'fulfilment'].includes(roleCode))

  if (!allowed) return null
  return { userId: user.id, orgId: profile.organization_id }
}
