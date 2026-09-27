/**
 * Compatibility-only normalization. These aliases are evidenced in the
 * repository's current authorization and notification code. They are not new
 * business roles and must not be used to grant new-engine permissions.
 */
const LEGACY_ROLE_ALIASES: Readonly<Record<string, string>> = {
  SA: 'SUPER_ADMIN',
  SUPER: 'SUPER_ADMIN',
  SUPERADMIN: 'SUPER_ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
  SUPER_ADMINISTRATOR: 'SUPER_ADMIN',
  ADMIN: 'HQ_ADMIN',
  ADMIN_HQ: 'HQ_ADMIN',
  HQ: 'HQ_ADMIN',
  HQ_ADMIN: 'HQ_ADMIN',
  POWER: 'POWER_USER',
  POWER_USER: 'POWER_USER',
  PU: 'POWER_USER',
  DIST: 'DISTRIBUTOR',
  DISTRIBUTOR: 'DISTRIBUTOR',
  MFG: 'MANUFACTURER',
  MANU: 'MANUFACTURER',
  MANUFACTURER: 'MANUFACTURER',
  MFR: 'MANUFACTURER',
  WH: 'WAREHOUSE',
  WAREHOUSE: 'WAREHOUSE',
  SHOP: 'SHOP',
  USER: 'USER',
  STAFF: 'USER',
  GUEST: 'GUEST',
  MANAGER: 'MANAGER',
}

export function normalizeLegacyRoleAlias(roleCode?: string | null): string | null {
  const normalized = String(roleCode || '').trim().replace(/[\s-]+/g, '_').toUpperCase()
  if (!normalized) return null
  return LEGACY_ROLE_ALIASES[normalized] ?? normalized
}

export function legacyRoleLevel(roleLevel?: number | null, roleCode?: string | null): number | null {
  if (typeof roleLevel === 'number' && Number.isFinite(roleLevel)) return roleLevel
  switch (normalizeLegacyRoleAlias(roleCode)) {
    case 'SUPER_ADMIN': return 1
    case 'HQ_ADMIN': return 10
    case 'POWER_USER': return 20
    default: return null
  }
}

export { LEGACY_ROLE_ALIASES }
