import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Legacy evaluators for routes that had no role check of their own. Used only
 * as the LEGACY_ENFORCED/SHADOW decision; S&A decides once cut over.
 */
export async function legacyRoleLevelAtMost(userId: string, maxLevel: number): Promise<boolean> {
  const admin = createAdminClient() as any
  const { data } = await admin
    .from('users')
    .select('is_active, account_scope, roles:role_code(role_level)')
    .eq('id', userId)
    .maybeSingle()
  const role = Array.isArray(data?.roles) ? data.roles[0] : data?.roles
  return data?.is_active === true && data?.account_scope === 'portal'
    && typeof role?.role_level === 'number' && role.role_level <= maxLevel
}
