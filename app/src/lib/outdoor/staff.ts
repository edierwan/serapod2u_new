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
    .select('id, organization_id, role_code, organizations!fk_users_organization(id, org_type_code), roles(role_level, role_code)')
    .eq('id', user.id)
    .single()

  if (!profile || !isOutdoorStaffProfile(profile)) return null
  return { userId: user.id, orgId: profile.organization_id }
}

export function isOutdoorStaffProfile(profile: any) {
  const org = Array.isArray(profile?.organizations) ? profile.organizations[0] : profile?.organizations
  const role = Array.isArray(profile?.roles) ? profile.roles[0] : profile?.roles
  const orgType = org?.org_type_code
  const roleLevel = Number(role?.role_level ?? 99)
  const codes = [role?.role_code, profile?.role_code].map((code) => String(code || '').toLowerCase())
  const isSystemAdmin = codes.some((code) =>
    ['super', 'superadmin', 'super_admin', 'sa', 'hq_admin', 'hq'].includes(code),
  )
  if (isSystemAdmin || roleLevel <= 10) return true
  const isHqOperator = codes.some((code) =>
    ['admin', 'org_admin', 'warehouse', 'fulfilment'].includes(code),
  )
  return orgType === 'HQ' && (roleLevel <= 30 || isHqOperator)
}
