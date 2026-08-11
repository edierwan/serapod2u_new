/**
 * Protect portal employment organization from accidental SHOP reassignment.
 *
 * Root cause of "admin menu missing": HQ/DIST/WH users can be moved onto a SHOP
 * org via consumer profile shop-link or /api/shops/create auto-link. Sidebar
 * then hides Reporting/Finance/Notifications/Settings by allowedOrgTypes.
 */

export const EMPLOYMENT_ORG_TYPES = ['HQ', 'DIST', 'WH', 'MFG', 'MANU'] as const

export const PROTECTED_PORTAL_ROLE_CODES = [
  'SUPER',
  'SUPERADMIN',
  'HQ_ADMIN',
  'DIST_ADMIN',
  'WH_ADMIN',
  'MFG_ADMIN',
] as const

export type EmploymentOrgGuardInput = {
  currentOrgTypeCode?: string | null
  currentRoleCode?: string | null
  currentRoleLevel?: number | null
  currentAccountScope?: string | null
  nextOrgTypeCode?: string | null
}

export function isEmploymentOrgType(orgTypeCode?: string | null): boolean {
  if (!orgTypeCode) return false
  return (EMPLOYMENT_ORG_TYPES as readonly string[]).includes(orgTypeCode)
}

export function isProtectedPortalRole(input: {
  roleCode?: string | null
  roleLevel?: number | null
  accountScope?: string | null
}): boolean {
  const roleCode = String(input.roleCode || '').toUpperCase()
  if ((PROTECTED_PORTAL_ROLE_CODES as readonly string[]).includes(roleCode)) {
    return true
  }

  // Portal business staff (role level 1-40). Consumers / shop users are typically higher.
  const scope = String(input.accountScope || 'portal').toLowerCase()
  const level = typeof input.roleLevel === 'number' ? input.roleLevel : null
  if (scope === 'portal' && level !== null && level <= 40) {
    return true
  }

  return false
}

/**
 * Returns an error message when linking/moving the user onto a SHOP org is unsafe.
 * Returns null when the change is allowed.
 */
export function getShopOrgReassignmentBlockReason(input: EmploymentOrgGuardInput): string | null {
  if (input.nextOrgTypeCode !== 'SHOP') return null

  if (isEmploymentOrgType(input.currentOrgTypeCode)) {
    return 'Cannot move a portal employment account onto a shop organization. This would remove HQ/admin menus. Use User Management only if an intentional org transfer is required.'
  }

  if (
    isProtectedPortalRole({
      roleCode: input.currentRoleCode,
      roleLevel: input.currentRoleLevel,
      accountScope: input.currentAccountScope,
    })
  ) {
    return 'Cannot link this portal admin/staff account to a shop organization from profile or shop creation.'
  }

  return null
}
