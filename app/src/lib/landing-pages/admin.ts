import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export class LandingPageApiError extends Error {
  status: number

  constructor(message: string, status = 500) {
    super(message)
    this.status = status
  }
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export async function requireLandingPageAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new LandingPageApiError('Unauthorized', 401)
  }

  const adminClient = createAdminClient() as any
  const { data: profile, error: profileError } = await adminClient
    .from('users')
    .select(`
      id,
      email,
      full_name,
      role_code,
      organization_id,
      organizations:organization_id (id, org_name, org_type_code, org_code),
      roles:role_code (role_name, role_level)
    `)
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile) {
    throw new LandingPageApiError('User profile not found.', 404)
  }

  const organization = firstRelation(profile.organizations)
  const role = firstRelation(profile.roles)
  const organizationId = profile.organization_id ?? organization?.id ?? null
  const roleLevel = role?.role_level ?? 999

  if (!organizationId) {
    throw new LandingPageApiError('User organization is required.', 403)
  }

  if (organization?.org_type_code !== 'HQ' || roleLevel > 30) {
    throw new LandingPageApiError('Insufficient permissions for Landing Pages.', 403)
  }

  return {
    adminClient,
    user,
    organizationId,
    profile: {
      ...profile,
      organization_id: organizationId,
      organizations: organization,
      roles: role,
    },
  }
}