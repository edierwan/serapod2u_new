/**
 * Canonical staff test for legacy (pre-S&A) evaluators and page gates.
 *
 * Staff is an identity fact: an INTERNAL_EMPLOYEE principal with an active
 * account. The legacy role level is only a narrowing ceiling (an admin-level
 * check stays admin-level) and never makes anyone staff by itself — a
 * store consumer or a shop account carrying a legacy USER/HQ role is not
 * staff. Mirrors public.sa_actor_is_staff (which additionally requires an
 * active S&A membership and assignment; the S&A decision itself is taken by
 * the operation guards).
 */
export interface StaffProfile {
  principal_type?: string | null
  is_active?: boolean | null
  account_status?: string | null
}

export function isCanonicalStaff(profile: StaffProfile | null | undefined, roleLevel: number | null | undefined, maxRoleLevel = 40): boolean {
  if (!profile) return false
  if (profile.principal_type !== 'INTERNAL_EMPLOYEE') return false
  if (profile.is_active !== true) return false
  if (profile.account_status && !['ACTIVE', 'INVITED'].includes(profile.account_status)) return false
  const level = Number(roleLevel)
  return Number.isFinite(level) && level > 0 && level <= maxRoleLevel
}
