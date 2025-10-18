// Menu Access Control Configuration
// Defines which menu items are visible based on user role and organization type

export interface MenuAccessRule {
  allowedRoles?: string[]  // Role codes that can access this menu
  allowedOrgTypes?: string[]  // Organization types that can access this menu
  minRoleLevel?: number  // Minimum role level required (lower number = higher access)
  maxRoleLevel?: number  // Maximum role level allowed
}

export interface MenuItem {
  id: string
  label: string
  icon: any
  description?: string
  access?: MenuAccessRule  // Access rules for this menu item
  submenu?: SubMenuItem[]
}

export interface SubMenuItem {
  id: string
  label: string
  icon: any
  access?: MenuAccessRule  // Access rules for submenu items
}

/**
 * Role Hierarchy (role_level):
 * 1  = SUPERADMIN, SUPER (Full system access)
 * 10 = HQ_ADMIN (Headquarters administrator)
 * 20 = MANU_ADMIN (Manufacturer administrator)
 * 30 = DIST_ADMIN (Distributor administrator)
 * 40 = WH_MANAGER (Warehouse manager)
 * 50 = SHOP_MANAGER (Shop manager)
 * 60 = USER (Standard user)
 * 70 = GUEST (Guest/read-only)
 */

/**
 * Organization Types:
 * HQ   = Headquarters
 * MANU = Manufacturer (Factory)
 * DIST = Distributor
 * WH   = Warehouse
 * SHOP = Retail Shop
 */

/**
 * Check if user has access to a menu item
 */
export function hasMenuAccess(
  userProfile: {
    role_code: string
    organizations: {
      org_type_code: string
    }
    roles: {
      role_level: number
    }
  },
  access?: MenuAccessRule
): boolean {
  // No access rules means accessible to all
  if (!access) return true

  const userRoleCode = userProfile.role_code
  const userOrgType = userProfile.organizations?.org_type_code
  const userRoleLevel = userProfile.roles?.role_level

  // Check role-based access
  if (access.allowedRoles && access.allowedRoles.length > 0) {
    if (!access.allowedRoles.includes(userRoleCode)) {
      return false
    }
  }

  // Check organization type access
  if (access.allowedOrgTypes && access.allowedOrgTypes.length > 0) {
    if (!access.allowedOrgTypes.includes(userOrgType)) {
      return false
    }
  }

  // Check minimum role level (lower number = higher privilege)
  if (access.minRoleLevel !== undefined) {
    if (userRoleLevel < access.minRoleLevel) {
      return false
    }
  }

  // Check maximum role level
  if (access.maxRoleLevel !== undefined) {
    if (userRoleLevel > access.maxRoleLevel) {
      return false
    }
  }

  return true
}

/**
 * Filter menu items based on user access
 */
export function filterMenuItems(
  menuItems: MenuItem[],
  userProfile: any
): MenuItem[] {
  return menuItems
    .filter(item => hasMenuAccess(userProfile, item.access))
    .map(item => {
      // Filter submenu items if they exist
      if (item.submenu && item.submenu.length > 0) {
        return {
          ...item,
          submenu: item.submenu.filter(subItem =>
            hasMenuAccess(userProfile, subItem.access)
          )
        }
      }
      return item
    })
    // Remove items with empty submenus
    .filter(item => {
      if (item.submenu) {
        return item.submenu.length > 0
      }
      return true
    })
}
