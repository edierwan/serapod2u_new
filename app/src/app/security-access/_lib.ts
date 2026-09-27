import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { checkPermissionForUser } from '@/lib/server/permissions'
import { redirect } from 'next/navigation'

export async function getSecurityAccessContext() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('users').select(`*,organizations:organization_id(id,org_name,org_type_code,org_code),roles:role_code(role_name,role_level)`).eq('id', user.id).single()
  if (!profile || !profile.is_active) redirect('/login')
  const organizations = Array.isArray(profile.organizations) ? profile.organizations[0] : profile.organizations
  const roles = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles
  const access = await checkPermissionForUser(user.id, 'manage_authorization')
  return { user, userProfile: { ...profile, organizations, roles }, allowed: access.allowed }
}
