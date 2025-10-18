/**
 * Organization Hierarchy Utilities
 * 
 * Helper functions for managing organization hierarchy relationships
 * based on the database constraints defined in validate_org_hierarchy()
 */

export type OrgType = 'HQ' | 'MFG' | 'DIST' | 'WH' | 'SHOP'

export interface Organization {
  id: string
  org_code: string
  org_name: string
  org_type_code: OrgType
  parent_org_id?: string | null
}

/**
 * Get valid parent organization types for a given org type
 * 
 * Hierarchy Rules:
 * - HQ: No parent allowed
 * - MFG (Manufacturer): Can have HQ parent or be independent
 * - DIST (Distributor): Must have HQ parent
 * - WH (Warehouse): Can have HQ or Distributor parent
 * - SHOP: Must have Distributor parent
 */
export function getValidParentTypes(orgType: OrgType): OrgType[] {
  switch (orgType) {
    case 'HQ':
      return [] // No parent allowed
    case 'MFG':
      return ['HQ'] // Optional: can be independent or under HQ
    case 'DIST':
      return ['HQ'] // Required: must be under HQ
    case 'WH':
      return ['HQ', 'DIST'] // Can be under HQ or Distributor
    case 'SHOP':
      return ['DIST'] // Required: must be under Distributor
    default:
      return []
  }
}

/**
 * Filter organizations to only valid parents for a given org type
 */
export function getValidParentOrgs(
  orgType: OrgType,
  allOrgs: Organization[]
): Organization[] {
  const validTypes = getValidParentTypes(orgType)
  
  if (validTypes.length === 0) {
    return [] // No parents allowed (e.g., HQ)
  }
  
  return allOrgs.filter(org => validTypes.includes(org.org_type_code))
}

/**
 * Check if parent is required for an org type
 */
export function isParentRequired(orgType: OrgType): boolean {
  return orgType === 'DIST' || orgType === 'SHOP'
}

/**
 * Check if parent is optional for an org type
 */
export function isParentOptional(orgType: OrgType): boolean {
  return orgType === 'MFG' || orgType === 'WH'
}

/**
 * Check if an org type can have a specific parent type
 */
export function isValidParentType(
  childType: OrgType,
  parentType: OrgType
): boolean {
  const validTypes = getValidParentTypes(childType)
  return validTypes.includes(parentType)
}

/**
 * Get user-friendly help text for parent selection
 */
export function getParentHelpText(orgType: OrgType): string {
  switch (orgType) {
    case 'HQ':
      return 'HQ organizations are at the top of the hierarchy and cannot have a parent'
    case 'MFG':
      return 'Manufacturers can report to HQ or operate independently'
    case 'DIST':
      return 'Distributors must report to an HQ organization'
    case 'WH':
      return 'Warehouses must report to either HQ or a Distributor'
    case 'SHOP':
      return 'Shops must report to a Distributor'
    default:
      return ''
  }
}

/**
 * Get user-friendly label for parent field
 */
export function getParentFieldLabel(orgType: OrgType): string {
  if (isParentRequired(orgType)) {
    return 'Parent Organization *'
  } else if (isParentOptional(orgType)) {
    return 'Parent Organization (Optional)'
  } else {
    return 'Parent Organization'
  }
}

/**
 * Parse database error to user-friendly message
 */
export function parseHierarchyError(error: Error | string): string {
  const message = typeof error === 'string' ? error : error.message
  
  if (message.includes('Headquarters') || message.includes('HQ cannot have parent')) {
    return 'HQ organizations cannot report to another organization'
  }
  
  if (message.includes('Manufacturer must report to HQ')) {
    return 'Manufacturers can only report to HQ organizations'
  }
  
  if (message.includes('Distributor must report to HQ') || message.includes('Distributor must have')) {
    return 'Distributors must report to an HQ organization'
  }
  
  if (message.includes('Warehouse must report')) {
    return 'Warehouses must report to either HQ or a Distributor'
  }
  
  if (message.includes('Shop must report to Distributor') || message.includes('Shop must have')) {
    return 'Shops must report to a Distributor'
  }
  
  if (message.includes('Cannot change to Shop') || message.includes('has child organizations')) {
    return 'Cannot change to Shop type - this organization has child organizations that must be reassigned first'
  }
  
  if (message.includes('incompatible child organizations')) {
    return 'Cannot change organization type - some child organizations are not compatible with the new type'
  }
  
  return message
}

/**
 * Validate organization hierarchy before saving
 * Returns error message if invalid, null if valid
 */
export function validateOrgHierarchy(
  orgType: OrgType,
  parentOrgId: string | null | undefined,
  parentOrgType?: OrgType
): string | null {
  // HQ cannot have parent
  if (orgType === 'HQ' && parentOrgId) {
    return 'HQ organizations cannot have a parent organization'
  }
  
  // Required parent check
  if (isParentRequired(orgType) && !parentOrgId) {
    const typeName = orgType === 'DIST' ? 'Distributors' : 'Shops'
    return `${typeName} must have a parent organization`
  }
  
  // Valid parent type check
  if (parentOrgId && parentOrgType) {
    if (!isValidParentType(orgType, parentOrgType)) {
      return `Invalid parent type: ${orgType} cannot report to ${parentOrgType}`
    }
  }
  
  return null
}

/**
 * Get org type display name
 */
export function getOrgTypeName(orgType: OrgType): string {
  const names: Record<OrgType, string> = {
    HQ: 'Headquarters',
    MFG: 'Manufacturer',
    DIST: 'Distributor',
    WH: 'Warehouse',
    SHOP: 'Shop'
  }
  return names[orgType] || orgType
}

/**
 * Get hierarchy level (for sorting/display)
 */
export function getHierarchyLevel(orgType: OrgType): number {
  const levels: Record<OrgType, number> = {
    HQ: 1,
    MFG: 2,
    DIST: 3,
    WH: 4,
    SHOP: 5
  }
  return levels[orgType] || 99
}

/**
 * Check if org type change is allowed based on children
 */
export async function validateOrgTypeChange(
  currentType: OrgType,
  newType: OrgType,
  hasChildren: boolean,
  childrenTypes: OrgType[] = []
): Promise<string | null> {
  if (currentType === newType) {
    return null // No change
  }
  
  // Cannot change to SHOP if has children
  if (newType === 'SHOP' && hasChildren) {
    return 'Cannot change to Shop - organization has child organizations'
  }
  
  // If changing to DIST, check children are compatible (WH or SHOP only)
  if (newType === 'DIST' && hasChildren) {
    const incompatible = childrenTypes.filter(t => t !== 'WH' && t !== 'SHOP')
    if (incompatible.length > 0) {
      return 'Cannot change to Distributor - has incompatible child organizations'
    }
  }
  
  // If changing to HQ, check children are compatible (MFG, DIST, WH only)
  if (newType === 'HQ' && hasChildren) {
    const incompatible = childrenTypes.filter(t => t === 'SHOP')
    if (incompatible.length > 0) {
      return 'Cannot change to HQ - shops cannot report directly to HQ'
    }
  }
  
  return null
}
