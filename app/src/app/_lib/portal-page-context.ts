import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

/**
 * Shared auth + profile loader for portal shell pages
 * (Reporting, Users, My Profile) that render DashboardContent.
 */
export async function getPortalPageContext() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect('/login')

  const { data: userProfile, error: userProfileError } = await supabase
    .from('users')
    .select(`
      *,
      organizations:organization_id (
        id,
        org_name,
        org_type_code,
        org_code
      ),
      roles:role_code (
        role_name,
        role_level
      )
    `)
    .eq('id', user.id)
    .single()

  if (userProfileError || !userProfile) redirect('/login')
  if (!userProfile.is_active) redirect('/login')

  const organization = Array.isArray(userProfile.organizations)
    ? userProfile.organizations[0]
    : userProfile.organizations
  const roles = Array.isArray(userProfile.roles)
    ? userProfile.roles[0]
    : userProfile.roles
  const organizationId = userProfile.organization_id ?? organization?.id ?? null
  if (!organizationId) redirect('/login')

  return {
    user,
    userProfile: {
      ...userProfile,
      organization_id: organizationId,
      organizations: organization,
      roles,
    },
  }
}
