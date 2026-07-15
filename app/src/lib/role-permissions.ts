export type RolePermissionMap = Record<string, boolean>

export const DEFAULT_ROLE_PERMISSIONS: Record<number, string[]> = {
    1: ['*'],
    10: [
        'view_dashboard', 'view_reports', 'export_reports',
        'view_inventory', 'view_inventory_value', 'view_inventory_cost', 'adjust_stock', 'post_stock_count', 'manage_inventory_settings',
        'view_orders', 'create_orders', 'approve_orders', 'cancel_orders', 'view_order_value',
        'view_products', 'create_products', 'edit_products', 'delete_products', 'view_product_cost',
        'view_qr_tracking', 'scan_qr', 'manage_journeys', 'view_scan_history',
        'view_warehouse', 'receive_goods', 'ship_goods', 'view_receiving_value',
        'view_accounting', 'manage_chart_of_accounts', 'post_journal_entries', 'view_gl_reports', 'manage_fiscal_years',
        'view_organizations', 'create_organizations', 'edit_organizations',
        'view_users', 'create_users', 'edit_users', 'delete_users', 'reset_passwords', 'manage_roles',
        'view_settings', 'edit_org_settings', 'manage_org_chart', 'manage_notifications', 'data_migration',
    ],
    20: [
        'view_dashboard', 'view_reports', 'export_reports',
        'view_inventory', 'view_inventory_value', 'view_inventory_cost', 'adjust_stock', 'post_stock_count', 'manage_inventory_settings',
        'view_orders', 'create_orders', 'approve_orders', 'cancel_orders', 'view_order_value',
        'view_products', 'create_products', 'edit_products', 'view_product_cost',
        'view_qr_tracking', 'scan_qr', 'manage_journeys', 'view_scan_history',
        'view_warehouse', 'receive_goods', 'ship_goods', 'view_receiving_value',
        'view_accounting', 'manage_chart_of_accounts', 'post_journal_entries', 'view_gl_reports', 'manage_fiscal_years',
        'view_organizations', 'create_organizations', 'edit_organizations',
        'view_users', 'create_users', 'edit_users',
        'view_settings', 'edit_org_settings', 'manage_org_chart', 'manage_notifications', 'data_migration',
    ],
    30: [
        'view_dashboard', 'view_reports',
        'view_inventory', 'view_inventory_value', 'adjust_stock', 'post_stock_count',
        'view_orders', 'create_orders', 'approve_orders', 'cancel_orders', 'view_order_value',
        'view_products',
        'view_qr_tracking', 'scan_qr', 'manage_journeys', 'view_scan_history',
        'view_warehouse', 'receive_goods', 'ship_goods', 'view_receiving_value',
        'view_organizations',
        'view_users', 'create_users', 'edit_users',
        'view_settings',
    ],
    40: [
        'view_dashboard',
        'view_inventory',
        'view_orders', 'create_orders',
        'view_products',
        'view_qr_tracking', 'scan_qr',
        'view_warehouse', 'receive_goods', 'ship_goods',
        'view_organizations',
        'view_users',
        'view_settings',
    ],
    50: [
        'view_dashboard',
        'view_inventory',
        'view_orders',
        'view_products',
        'view_organizations',
        'view_settings',
    ],
}

export function resolveRoleLevel(roleLevel?: number, roleCode?: string | null): number | undefined {
    if (typeof roleLevel === 'number' && Number.isFinite(roleLevel)) return roleLevel

    const normalized = String(roleCode || '').trim().toUpperCase()
    if (!normalized) return undefined
    if (normalized === 'SUPERADMIN' || normalized === 'SUPER' || normalized === 'SA' || normalized === 'SUPER_ADMIN') return 1
    if (normalized === 'HQ_ADMIN' || normalized === 'HQ' || normalized === 'ADMIN' || normalized === 'ADMIN_HQ') return 10
    if (normalized === 'POWER_USER' || normalized === 'POWER') return 20
    return undefined
}

export function buildDefaultPermissionMap(roleLevel?: number): RolePermissionMap {
    const defaults = DEFAULT_ROLE_PERMISSIONS[roleLevel || 50] || DEFAULT_ROLE_PERMISSIONS[50]
    const permissions: RolePermissionMap = {}

    if (defaults.includes('*')) {
        Object.values(DEFAULT_ROLE_PERMISSIONS).forEach((rolePermissions) => {
            rolePermissions.forEach((permission) => {
                if (permission !== '*') permissions[permission] = true
            })
        })
        return permissions
    }

    defaults.forEach((permission) => {
        permissions[permission] = true
    })

    return permissions
}

export function normalizeRolePermissions(roleLevel: number | undefined, rawPermissions: unknown): RolePermissionMap {
    const normalized = buildDefaultPermissionMap(roleLevel)

    if (rawPermissions && typeof rawPermissions === 'object' && !Array.isArray(rawPermissions)) {
        Object.entries(rawPermissions as Record<string, unknown>).forEach(([key, value]) => {
            if (typeof value === 'boolean') {
                normalized[key] = value
            }
        })
    }

    return normalized
}
