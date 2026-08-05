import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getSerappAccessDecision } from '@/lib/serapp/access'
import type { SerappUserProfile } from '@/lib/serapp/types'

export type { SerappUserProfile }

export async function getSerappPageContext() {
  const supabase = await createClient()

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) redirect('/login?next=/serapp')

  const { data: userProfile, error: userProfileError } = await supabase
    .from('users')
    .select(`
      id,
      email,
      full_name,
      role_code,
      organization_id,
      account_scope,
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

  if (userProfileError || !userProfile) redirect('/login?next=/serapp')

  const organization = Array.isArray(userProfile.organizations)
    ? userProfile.organizations[0]
    : userProfile.organizations
  const roles = Array.isArray(userProfile.roles)
    ? userProfile.roles[0]
    : userProfile.roles

  if (!organization?.id || !userProfile.organization_id) {
    redirect('/login?next=/serapp')
  }

  const profile: SerappUserProfile = {
    id: userProfile.id,
    email: userProfile.email,
    full_name: userProfile.full_name,
    role_code: userProfile.role_code,
    organization_id: userProfile.organization_id,
    account_scope: userProfile.account_scope,
    organizations: organization,
    roles: {
      role_name: roles?.role_name || userProfile.role_code,
      role_level: roles?.role_level ?? 99,
    },
  }

  const access = getSerappAccessDecision({
    accountScope: profile.account_scope,
    orgTypeCode: profile.organizations.org_type_code,
    organizationId: profile.organization_id,
    roleLevel: profile.roles.role_level,
  })

  return {
    user,
    userProfile: profile,
    access,
    canUseSerapp: access.allowed,
  }
}
