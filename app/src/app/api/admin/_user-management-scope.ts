import { SupabaseClient } from '@supabase/supabase-js'

type AdminClient = SupabaseClient<any, 'public', any>

export interface ScopedUserRow {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  referral_phone: string | null
  is_active: boolean
  role_code: string
  organization_id: string | null
  created_at: string
  roles?: {
    role_name?: string | null
    role_level?: number | null
  } | null
}

export interface ScopedShopUserResult {
  shopUsers: ScopedUserRow[]
  allVisibleUsers: ScopedUserRow[]
}

export function resolveCurrentUserLevel(roleCode?: string | null): number {
  const normalized = roleCode?.toUpperCase()
  if (normalized === 'SUPERADMIN' || normalized === 'SUPER' || normalized === 'SA') return 1
  if (normalized === 'HQ_ADMIN' || normalized === 'HQ') return 10
  if (normalized === 'POWER_USER' || normalized === 'POWER') return 20
  return 999
}

export async function loadScopedShopUsers(
  admin: AdminClient,
  currentUserRoleCode?: string | null,
  currentUserOrgId?: string | null,
): Promise<ScopedShopUserResult> {
  const currentUserLevel = resolveCurrentUserLevel(currentUserRoleCode)
  const isPowerUser = currentUserLevel <= 20

  const allUsers: ScopedUserRow[] = []
  const pageSize = 1000
  let offset = 0
  let hasMore = true

  while (hasMore) {
    let query = admin
      .from('users')
      .select(`
        id,
        email,
        full_name,
        phone,
        referral_phone,
        is_active,
        role_code,
        organization_id,
        created_at,
        roles:role_code (
          role_name,
          role_level
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (!isPowerUser && currentUserOrgId) {
      query = query.or(`organization_id.eq.${currentUserOrgId},organization_id.is.null`)
    }

    const { data, error, count } = await query
    if (error) throw error

    if (data && data.length > 0) {
      allUsers.push(...(data as ScopedUserRow[]))
      offset += pageSize
      hasMore = count ? allUsers.length < count : data.length === pageSize
    } else {
      hasMore = false
    }
  }

  const visibleUsers = allUsers.filter((user) => {
    const userRoleLevel = user.roles?.role_level || 999
    if (currentUserLevel <= 20) return true
    return userRoleLevel >= currentUserLevel
  })

  const { data: organizations, error: organizationsError } = await admin
    .from('organizations')
    .select('id, org_type_code')
    .eq('is_active', true)

  if (organizationsError) throw organizationsError

  const orgTypeById = new Map((organizations || []).map((org: any) => [org.id, org.org_type_code]))

  const shopUsers = visibleUsers.filter((user) => {
    if (!user.organization_id) return false
    return orgTypeById.get(user.organization_id) === 'SHOP'
  })

  return {
    shopUsers,
    allVisibleUsers: visibleUsers,
  }
}

export function normalizePhone(value?: string | null): string {
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('60')) return digits
  if (digits.startsWith('0')) return `6${digits}`
  return digits
}