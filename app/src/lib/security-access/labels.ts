/**
 * Human-readable vocabulary for the Security & Access UI. Presentation only:
 * nothing here participates in an authorization decision.
 */

export interface PermissionLabel {
  label: string
  group: string
  resourceType: string
}

const ACTIONS: Record<string, string> = {
  view: 'View', create: 'Create', verify: 'Verify', post: 'Post', request: 'Request',
  approve: 'Approve', dispatch: 'Dispatch', receive: 'Receive', assign: 'Assign', manage: 'Manage',
}

const RESOURCES: Record<string, { noun: string; group: string; resourceType: string }> = {
  'inventory.stock_count': { noun: 'Stock Count', group: 'Stock Count', resourceType: 'stock_count' },
  'inventory.transfer': { noun: 'Stock Transfer', group: 'Stock Transfer', resourceType: 'stock_transfer' },
  'security.access': { noun: 'Security & Access', group: 'Security Administration', resourceType: 'security_access' },
  'security.role': { noun: 'Business Roles', group: 'Security Administration', resourceType: 'business_role' },
  'security.permission': { noun: 'Permission Catalog', group: 'Security Administration', resourceType: 'permission_catalog' },
}

export const PERMISSION_GROUP_ORDER = ['Stock Count', 'Stock Transfer', 'Security Administration']

const titleCase = (value: string) => value.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export function permissionLabel(permissionKey: string): PermissionLabel {
  const [module = '', resource = '', action = ''] = permissionKey.split('.')
  const known = RESOURCES[`${module}.${resource}`]
  const verb = ACTIONS[action] ?? titleCase(action)
  if (known) return { label: `${verb} ${known.noun}`, group: known.group, resourceType: known.resourceType }
  return { label: `${verb} ${titleCase(resource)}`, group: titleCase(module) || 'Other', resourceType: resource || 'resource' }
}

export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  stock_count: 'Stock Count',
  stock_transfer: 'Stock Transfer',
  business_role: 'Business Role',
  security_access: 'Security & Access',
  permission_catalog: 'Permission Catalog',
}

export function resourceTypeLabel(resourceType: string): string {
  return RESOURCE_TYPE_LABELS[resourceType] ?? titleCase(resourceType)
}

export const MODE_LABELS: Record<string, { label: string; tone: string; help: string }> = {
  LEGACY_ENFORCED: { label: 'Legacy enforced', tone: 'bg-gray-100 text-gray-700', help: 'Existing role permissions decide. The new model is not consulted for the outcome.' },
  SHADOW: { label: 'Shadow', tone: 'bg-blue-50 text-blue-700', help: 'Existing role permissions decide; the new model is evaluated and compared for diagnostics.' },
  NEW_ENFORCED: { label: 'New enforced', tone: 'bg-emerald-50 text-emerald-700', help: 'The new Security & Access model decides. A legacy allow cannot override a new deny.' },
  LEGACY_RETIRED: { label: 'Legacy retired', tone: 'bg-purple-50 text-purple-700', help: 'Only the new Security & Access model is used.' },
}

export function modeLabel(mode: string) {
  return MODE_LABELS[mode] ?? { label: titleCase(mode.toLowerCase()), tone: 'bg-gray-100 text-gray-700', help: '' }
}

export const REASON_LABELS: Record<string, string> = {
  ALLOWED_BY_ASSIGNMENT: 'Allowed by an active role assignment whose scope covers this resource.',
  ACCOUNT_INACTIVE: 'The account is inactive.',
  MISSING_MEMBERSHIP: 'The user has no active membership in this organization.',
  MISSING_ASSIGNMENT: 'The user has no active role assignment in this organization.',
  MISSING_PERMISSION: 'None of the user’s business roles grants this permission.',
  MISSING_CONTEXT: 'The request is missing context the user’s scope needs (for example a warehouse).',
  SCOPE_MISMATCH: 'The user’s role applies to a different organization or warehouse.',
  LEGACY_ALLOWED: 'Allowed by the existing (legacy) role permissions.',
  LEGACY_DENIED: 'Denied by the existing (legacy) role permissions.',
  POLICY_ERROR: 'The policy could not be evaluated; access is denied for safety.',
}

export function reasonLabel(reasonCode: string | null | undefined): string {
  if (!reasonCode) return '—'
  return REASON_LABELS[reasonCode] ?? titleCase(reasonCode.toLowerCase())
}

export const COMPARISON_LABELS: Record<string, { label: string; tone: string }> = {
  MATCH_ALLOW: { label: 'Both allow', tone: 'bg-emerald-50 text-emerald-700' },
  MATCH_DENY: { label: 'Both deny', tone: 'bg-gray-100 text-gray-700' },
  LEGACY_ALLOW_NEW_DENY: { label: 'Legacy allows, new denies', tone: 'bg-amber-50 text-amber-800' },
  LEGACY_DENY_NEW_ALLOW: { label: 'Legacy denies, new allows', tone: 'bg-red-50 text-red-700' },
  SCOPE_MISMATCH: { label: 'Scope mismatch', tone: 'bg-amber-50 text-amber-800' },
  MISSING_ASSIGNMENT: { label: 'Missing assignment', tone: 'bg-amber-50 text-amber-800' },
  MISSING_CONTEXT: { label: 'Missing context', tone: 'bg-amber-50 text-amber-800' },
  POLICY_ERROR: { label: 'Policy error', tone: 'bg-red-50 text-red-700' },
}

export function comparisonLabel(comparison: string) {
  return COMPARISON_LABELS[comparison] ?? { label: titleCase(comparison.toLowerCase()), tone: 'bg-gray-100 text-gray-700' }
}

export const ORG_TYPE_LABELS: Record<string, string> = {
  HQ: 'Headquarters', WH: 'Warehouse', DIST: 'Distributor', MFG: 'Manufacturer', SHOP: 'Shop',
}

export function orgTypeLabel(orgType: string | null | undefined): string {
  return orgType ? ORG_TYPE_LABELS[orgType] ?? orgType : ''
}

export interface DirectoryOrganization {
  id: string
  org_name: string
  org_type_code: string | null
  parent_org_id: string | null
}

/** Warehouses owned by (or equal to) the selected organization, following the parent chain. */
export function warehousesForOrganization(organizations: DirectoryOrganization[], organizationId: string | null | undefined): DirectoryOrganization[] {
  const warehouses = organizations.filter(o => o.org_type_code === 'WH')
  if (!organizationId) return warehouses
  const byId = new Map(organizations.map(o => [o.id, o]))
  const underSelected = (org: DirectoryOrganization) => {
    let current: DirectoryOrganization | undefined = org
    for (let depth = 0; current && depth < 8; depth += 1) {
      if (current.id === organizationId) return true
      current = current.parent_org_id ? byId.get(current.parent_org_id) : undefined
    }
    return false
  }
  return warehouses.filter(underSelected)
}
