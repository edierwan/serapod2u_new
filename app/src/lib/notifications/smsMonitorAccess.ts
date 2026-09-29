import { isCanonicalStaff } from '@/lib/identity/staff'
import { userAllowed } from '@/lib/security-access/operation'

/**
 * Shared authorization check for the SMS delivery monitor endpoints
 * (GET/PATCH /api/settings/notifications/sms-activity and its
 * /refresh-status action). Kept in one place so the two routes can't
 * drift out of sync on who is allowed to view/operate the monitor.
 */
export async function canViewSmsMonitor(supabase: any, userId: string): Promise<boolean> {
  // The delivery monitors are an S&A decision (platform.notification_monitor.view);
  // the historical canonical-staff rule below is the legacy evaluator.
  return userAllowed(userId, 'platform.notification_monitor.view', () => legacyCanViewSmsMonitor(supabase, userId))
}

async function legacyCanViewSmsMonitor(supabase: any, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('users')
    .select('organization_id, is_active, account_status, principal_type, roles:role_code(role_level, role_code), organizations:organization_id(org_type_code)')
    .eq('id', userId)
    .single()

  const role = Array.isArray(data?.roles) ? data.roles[0] : data?.roles
  const org = Array.isArray(data?.organizations) ? data.organizations[0] : data?.organizations
  const roleLevel = Number(role?.role_level)
  const roleCode = String(role?.role_code || '')
  // Only canonical internal staff; the legacy level is a ceiling, not proof.
  if (!isCanonicalStaff(data, roleLevel, 40)) return false
  if (roleLevel <= 20 || ['super_admin', 'admin', 'org_admin'].includes(roleCode)) return true
  return org?.org_type_code === 'HQ'
}
