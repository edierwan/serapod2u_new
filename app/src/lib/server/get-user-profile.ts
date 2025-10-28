import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export interface UserProfileWithRelations {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role_code: string
  organization_id: string
  avatar_url: string | null
  signature_url: string | null
  is_active: boolean
  is_verified: boolean
  created_at: string
  updated_at: string
  organizations: {
    id: string
    org_name: string
    org_type_code: string
    org_code: string
  }
  roles: {
    role_name: string
    role_level: number
  }
}

export async function getServerUserProfile(): Promise<UserProfileWithRelations> {
  await headers()

  const supabase = await createClient()

  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  const { data: userProfile, error: userProfileError } = await supabase
    .from('users')
    .select(
      `*,
      organizations:organization_id (
        id,
        org_name,
        org_type_code,
        org_code
      ),
      roles:role_code (
        role_name,
        role_level
      )`
    )
    .eq('id', user.id)
    .single()

  if (userProfileError || !userProfile) {
    redirect('/login')
  }

  if (!userProfile.is_active) {
    redirect('/login')
  }

  return {
    ...userProfile,
    organizations: Array.isArray(userProfile.organizations)
      ? userProfile.organizations[0]
      : userProfile.organizations,
    roles: Array.isArray(userProfile.roles)
      ? userProfile.roles[0]
      : userProfile.roles
  } as UserProfileWithRelations
}
