import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export interface UserProfileWithRelations {
  id: string
  email: string
  full_name: string | null
  call_name?: string | null
  phone: string | null
  address?: string | null
  location?: string | null
  shop_name?: string | null
  referral_phone?: string | null
  role_code: string
  organization_id: string
  avatar_url: string | null
  signature_url: string | null
  is_active: boolean
  is_verified: boolean
  created_at: string
  updated_at: string
  account_scope: 'store' | 'portal' | null
  bank_id?: string | null
  bank_account_number?: string | null
  bank_account_holder_name?: string | null
  department_id?: string | null
  manager_user_id?: string | null
  position_id?: string | null
  employment_type?: string | null
  join_date?: string | null
  employment_status?: string | null
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
  msia_banks?: {
    id: string
    short_name: string
  } | null
  departments?: {
    id: string
    dept_code: string | null
    dept_name: string
  } | null
  manager?: {
    id: string
    full_name: string | null
    email: string
  } | null
  positions?: {
    id: string
    name: string
  } | null
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

  const { data: userProfile, error: userProfileError } = await (supabase as any)
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
      ),
      msia_banks:bank_id (
        id,
        short_name
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

  const [departmentResult, managerResult, positionResult] = await Promise.all([
    userProfile.department_id
      ? (supabase as any).from('departments').select('id, dept_code, dept_name').eq('id', userProfile.department_id).maybeSingle()
      : Promise.resolve({ data: null }),
    userProfile.manager_user_id
      ? (supabase as any).from('users').select('id, full_name, email').eq('id', userProfile.manager_user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    userProfile.position_id
      ? (supabase as any).from('hr_positions').select('id, name').eq('id', userProfile.position_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return {
    ...userProfile,
    organizations: Array.isArray(userProfile.organizations)
      ? userProfile.organizations[0]
      : userProfile.organizations,
    roles: Array.isArray(userProfile.roles)
      ? userProfile.roles[0]
      : userProfile.roles,
    msia_banks: Array.isArray((userProfile as any).msia_banks)
      ? (userProfile as any).msia_banks[0]
      : (userProfile as any).msia_banks,
    departments: departmentResult.data,
    manager: managerResult.data,
    positions: positionResult.data
  } as UserProfileWithRelations
}
