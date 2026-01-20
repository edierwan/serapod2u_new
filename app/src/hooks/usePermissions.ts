'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'

interface RolePermissions {
    [permissionId: string]: boolean
}

interface UsePermissionsResult {
    hasPermission: (permissionId: string) => boolean
    permissions: RolePermissions
    loading: boolean
    refresh: () => Promise<void>
}

// Default permissions based on role level
const DEFAULT_PERMISSIONS: Record<number, string[]> = {
    1: ['*'], // Super Admin has all permissions
    10: [
        'view_dashboard', 'view_reports', 'export_reports',
        'view_inventory', 'view_inventory_value', 'view_inventory_cost', 'adjust_stock', 'manage_inventory_settings',
        'view_orders', 'create_orders', 'approve_orders', 'cancel_orders', 'view_order_value',
        'view_products', 'create_products', 'edit_products', 'delete_products', 'view_product_cost',
        'view_qr_tracking', 'scan_qr', 'manage_journeys', 'view_scan_history',
        'view_warehouse', 'receive_goods', 'ship_goods', 'view_receiving_value',
        'view_accounting', 'manage_chart_of_accounts', 'post_journal_entries', 'view_gl_reports', 'manage_fiscal_years',
        'view_organizations', 'create_organizations', 'edit_organizations',
        'view_users', 'create_users', 'edit_users', 'delete_users', 'manage_roles',
        'view_settings', 'edit_org_settings', 'manage_notifications', 'data_migration',
    ],
    20: [
        'view_dashboard', 'view_reports', 'export_reports',
        'view_inventory', 'view_inventory_value', 'view_inventory_cost', 'adjust_stock', 'manage_inventory_settings',
        'view_orders', 'create_orders', 'approve_orders', 'cancel_orders', 'view_order_value',
        'view_products', 'create_products', 'edit_products', 'view_product_cost',
        'view_qr_tracking', 'scan_qr', 'manage_journeys', 'view_scan_history',
        'view_warehouse', 'receive_goods', 'ship_goods', 'view_receiving_value',
        'view_accounting', 'manage_chart_of_accounts', 'post_journal_entries', 'view_gl_reports', 'manage_fiscal_years',
        'view_organizations', 'create_organizations', 'edit_organizations',
        'view_users', 'create_users', 'edit_users',
        'view_settings', 'edit_org_settings', 'manage_notifications', 'data_migration',
    ],
    30: [
        'view_dashboard', 'view_reports',
        'view_inventory', 'view_inventory_value', 'adjust_stock',
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
        'view_users', // Added as fallback for Level 40
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

export function usePermissions(roleLevel?: number, roleCode?: string): UsePermissionsResult {
    const { supabase, isReady } = useSupabaseAuth()
    const [permissions, setPermissions] = useState<RolePermissions>({})
    const [loading, setLoading] = useState(true)

    const loadPermissions = useCallback(async () => {
        if (!isReady || roleLevel === undefined) {
            // Keep loading true while waiting for supabase to be ready
            // This prevents rendering with stale/default permissions
            console.log('[usePermissions] Waiting for supabase ready. isReady:', isReady, 'roleLevel:', roleLevel)
            return
        }

        console.log('[usePermissions] Loading permissions for roleLevel:', roleLevel)

        try {
            // Try to load permissions from database
            const { data: roleData, error } = await supabase
                .from('roles')
                .select('permissions')
                .eq('role_level', roleLevel)
                .single()

            console.log('[usePermissions] roleLevel:', roleLevel, 'DB response:', { roleData, error })

            if (error || !roleData?.permissions) {
                console.log('[usePermissions] Error or no permissions data, falling back to defaults for level', roleLevel)
                // Fall back to defaults only on error or missing data
                const defaults = DEFAULT_PERMISSIONS[roleLevel] || DEFAULT_PERMISSIONS[50]
                const perms: RolePermissions = {}

                if (defaults.includes('*')) {
                    // Super admin - all permissions
                    Object.keys(DEFAULT_PERMISSIONS).forEach(level => {
                        DEFAULT_PERMISSIONS[Number(level)].forEach(p => {
                            if (p !== '*') perms[p] = true
                        })
                    })
                } else {
                    defaults.forEach(p => perms[p] = true)
                }
                setPermissions(perms)
            } else {
                // Use database permissions with proper type handling
                const dbPerms = roleData.permissions
                console.log('[usePermissions] Using DB permissions:', dbPerms)
                if (dbPerms && typeof dbPerms === 'object' && !Array.isArray(dbPerms)) {
                    const validPerms: RolePermissions = {}
                    Object.entries(dbPerms as Record<string, unknown>).forEach(([key, value]) => {
                        if (typeof value === 'boolean') {
                            validPerms[key] = value
                        }
                    })
                    console.log('[usePermissions] Valid permissions set:', validPerms)

                    setPermissions(validPerms)
                } else {
                    // Fall back to defaults
                    const defaults = DEFAULT_PERMISSIONS[roleLevel] || DEFAULT_PERMISSIONS[50]
                    const fallbackPerms: RolePermissions = {}
                    defaults.forEach(p => fallbackPerms[p] = true)
                    setPermissions(fallbackPerms)
                }
            }
        } catch (err) {
            console.error('Error loading permissions:', err)
            // Fall back to defaults on error
            const defaults = DEFAULT_PERMISSIONS[roleLevel] || DEFAULT_PERMISSIONS[50]
            const perms: RolePermissions = {}
            defaults.forEach(p => perms[p] = true)
            setPermissions(perms)
        } finally {
            setLoading(false)
        }
    }, [isReady, roleLevel, supabase])

    useEffect(() => {
        loadPermissions()
    }, [loadPermissions])

    const hasPermission = useCallback((permissionId: string): boolean => {
        // Super admin (level 1) always has all permissions
        if (roleLevel === 1) return true

        // If still loading, return false (menu will re-render when loaded)
        if (loading) {
            console.log('[hasPermission] Still loading, returning false for:', permissionId)
            return false
        }

        // Check if permission exists in the loaded permissions
        const result = permissions[permissionId] === true
        console.log('[hasPermission]', permissionId, '=', result, 'permissions keys:', Object.keys(permissions))
        return result
    }, [permissions, roleLevel, loading])

    return {
        hasPermission,
        permissions,
        loading,
        refresh: loadPermissions
    }
}

// Convenience hook for checking a single permission
export function useHasPermission(permissionId: string, roleLevel?: number): boolean {
    const { hasPermission, loading } = usePermissions(roleLevel)

    if (loading) {
        // Return default based on role level during loading
        if (roleLevel === undefined) return false
        const defaults = DEFAULT_PERMISSIONS[roleLevel] || DEFAULT_PERMISSIONS[50]
        return defaults.includes('*') || defaults.includes(permissionId)
    }

    return hasPermission(permissionId)
}
