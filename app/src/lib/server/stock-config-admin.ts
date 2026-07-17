import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function getStockConfigAdminContext() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false as const, status: 401, error: 'Authentication required' }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, organization_id, role_code, roles(role_level), organizations(org_type_code)')
    .eq('id', user.id)
    .single()
  const roleLevel = Number((profile?.roles as any)?.role_level ?? 999)
  const orgType = String((profile?.organizations as any)?.org_type_code || '').toUpperCase()
  const roleCode = String(profile?.role_code || '').toUpperCase()
  const allowed = !profileError && orgType === 'HQ' && (
    roleLevel === 1 || roleLevel === 10 || ['SUPER', 'SUPERADMIN', 'HQ_ADMIN'].includes(roleCode)
  )
  if (!allowed) return { ok: false as const, status: 403, error: 'HQ administrator access required' }

  return { ok: true as const, user, supabase, admin: createAdminClient() as any }
}

