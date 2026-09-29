import { userAllowed } from '@/lib/security-access/operation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/** Same rule as the Store Orders admin API: ecommerce.order.manage, legacy HQ role level <= 30. */
export async function requireStoreOrderAdmin() {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return null

  const adminClient = createAdminClient()
  const { data: profile } = await adminClient
    .from('users')
    .select('id, organization_id, role_code, organizations!fk_users_organization(id, org_type_code), roles(role_level)')
    .eq('id', user.id)
    .single()
  if (!profile) return null

  const orgType = (profile.organizations as any)?.org_type_code
  const roleLevel = (profile.roles as any)?.role_level
  const allowed = await userAllowed(
    user.id,
    'ecommerce.order.manage',
    () => orgType === 'HQ' && roleLevel != null && roleLevel <= 30 && !!profile.organization_id,
    { organizationId: profile.organization_id },
  )
  if (!allowed) return null
  return { userId: user.id, orgId: profile.organization_id as string }
}
