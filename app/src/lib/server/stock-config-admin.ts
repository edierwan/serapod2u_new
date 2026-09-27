import { authorizeOperation, organizationResource } from '@/lib/security-access/operation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * HQ inventory administration context. The operation permission is decided
 * by S&A in the actor's organization; the historical HQ-admin rule is the
 * legacy evaluator.
 */
export async function getStockConfigAdminContext(permission: string = 'inventory.stock_config.manage') {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false as const, status: 401, error: 'Authentication required' }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, organization_id, role_code, roles:role_code(role_level), organizations:organization_id(org_type_code)')
    .eq('id', user.id)
    .single()
  const roleLevel = Number((profile?.roles as any)?.role_level ?? 999)
  const orgType = String((profile?.organizations as any)?.org_type_code || '').toUpperCase()
  const roleCode = String(profile?.role_code || '').toUpperCase()
  const allowed = !profileError && orgType === 'HQ' && (
    roleLevel === 1 || roleLevel === 10 || ['SUPER', 'SUPERADMIN', 'HQ_ADMIN'].includes(roleCode)
  )
  const saAllowed = profile?.organization_id
    ? await authorizeOperation({
        actorId: user.id,
        permission,
        resource: organizationResource('inventory_administration', profile.organization_id),
        legacy: () => allowed,
      }).then(d => d.decision === 'ALLOW').catch(() => false)
    : false
  if (!saAllowed) return { ok: false as const, status: 403, error: 'HQ administrator access required' }

  return { ok: true as const, user, supabase, admin: createAdminClient() as any }
}

