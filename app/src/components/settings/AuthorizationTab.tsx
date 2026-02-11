'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { usePermissions } from '@/hooks/usePermissions'
import { toast } from '@/components/ui/use-toast'
import {
    getAuthorizationDepartments,
    resetDepartmentPermissionOverrides,
    saveRolePermissions,
    searchAuthorizationUsers,
    testPermissionAccess,
    updateDepartmentPermissionOverrides
} from '@/lib/actions/authorization'
import {
    Shield,
    Users,
    Eye,
    EyeOff,
    Lock,
    Unlock,
    Save,
    RefreshCw,
    ChevronDown,
    ChevronRight,
    AlertCircle,
    CheckCircle,
    Settings,
    Package,
    FileText,
    BarChart3,
    Building2,
    Wallet,
    QrCode,
    Truck,
    ClipboardList,
    UserCog,
    Database
} from 'lucide-react'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

interface UserProfile {
    id: string
    email: string
    phone?: string | null
    role_code: string
    organization_id: string
    department_id?: string | null
    is_active: boolean
    organizations: {
        id: string
        org_name: string
        org_type_code: string
        org_code: string
    }
    roles: {
        role_name: string
        role_level: number
    }
}

interface AuthorizationTabProps {
    userProfile: UserProfile
}

interface Role {
    id: string
    role_code: string
    role_name: string
    role_level: number
    permissions: Record<string, any>
    is_active: boolean
}

interface PermissionOverrides {
    allow: string[]
    deny: string[]
}

interface DepartmentAuthorizationRecord {
    id: string
    dept_code: string | null
    dept_name: string
    permission_overrides: PermissionOverrides
    organization_id: string
    is_active: boolean
}

interface AuthorizationUserOption {
    id: string
    full_name: string | null
    email: string
    role_code: string | null
    role_level: number | null
    department_id: string | null
    department?: {
        dept_code: string | null
        dept_name: string | null
    } | null
}

interface PermissionCategory {
    id: string
    name: string
    icon: React.ElementType
    description: string
    permissions: Permission[]
}

interface Permission {
    id: string
    name: string
    description: string
    category: string
    defaultLevels: number[]  // Levels that have this permission by default
    sensitivity: 'low' | 'medium' | 'high' | 'critical'
}

// Define all available permissions in the system
const PERMISSION_CATEGORIES: PermissionCategory[] = [
    {
        id: 'dashboard',
        name: 'Dashboard & Reporting',
        icon: BarChart3,
        description: 'Access to dashboard and reporting features',
        permissions: [
            { id: 'view_dashboard', name: 'View Dashboard', description: 'Access to main dashboard', category: 'dashboard', defaultLevels: [1, 10, 20, 30, 40, 50], sensitivity: 'low' },
            { id: 'view_reports', name: 'View Reports', description: 'Access to reporting module', category: 'dashboard', defaultLevels: [1, 10, 20, 30], sensitivity: 'medium' },
            { id: 'export_reports', name: 'Export Reports', description: 'Export data from reports', category: 'dashboard', defaultLevels: [1, 10, 20], sensitivity: 'medium' },
        ]
    },
    {
        id: 'inventory',
        name: 'Inventory Management',
        icon: Package,
        description: 'Inventory viewing and management permissions',
        permissions: [
            { id: 'view_inventory', name: 'View Inventory', description: 'Access to inventory list', category: 'inventory', defaultLevels: [1, 10, 20, 30, 40], sensitivity: 'low' },
            { id: 'view_inventory_value', name: 'View Total Value', description: 'See total value column in inventory', category: 'inventory', defaultLevels: [1, 10, 20, 30], sensitivity: 'high' },
            { id: 'view_inventory_cost', name: 'View Cost Price', description: 'See cost price of items', category: 'inventory', defaultLevels: [1, 10, 20], sensitivity: 'critical' },
            { id: 'adjust_stock', name: 'Adjust Stock', description: 'Make stock adjustments', category: 'inventory', defaultLevels: [1, 10, 20, 30], sensitivity: 'high' },
            { id: 'manage_inventory_settings', name: 'Manage Settings', description: 'Configure inventory settings', category: 'inventory', defaultLevels: [1, 10, 20], sensitivity: 'medium' },
        ]
    },
    {
        id: 'orders',
        name: 'Order Management',
        icon: ClipboardList,
        description: 'Order processing and management',
        permissions: [
            { id: 'view_orders', name: 'View Orders', description: 'Access to order list', category: 'orders', defaultLevels: [1, 10, 20, 30, 40], sensitivity: 'low' },
            { id: 'create_orders', name: 'Create Orders', description: 'Create new orders', category: 'orders', defaultLevels: [1, 10, 20, 30, 40], sensitivity: 'low' },
            { id: 'approve_orders', name: 'Approve Orders', description: 'Approve pending orders', category: 'orders', defaultLevels: [1, 10, 20, 30], sensitivity: 'high' },
            { id: 'cancel_orders', name: 'Cancel Orders', description: 'Cancel orders', category: 'orders', defaultLevels: [1, 10, 20, 30], sensitivity: 'high' },
            { id: 'delete_orders', name: 'Delete Orders', description: 'Permanently delete orders', category: 'orders', defaultLevels: [1], sensitivity: 'critical' },
            { id: 'view_order_value', name: 'View Order Value', description: 'See order total values', category: 'orders', defaultLevels: [1, 10, 20, 30], sensitivity: 'medium' },
        ]
    },
    {
        id: 'products',
        name: 'Products',
        icon: Package,
        description: 'Product catalog management',
        permissions: [
            { id: 'view_products', name: 'View Products', description: 'Access to product list', category: 'products', defaultLevels: [1, 10, 20, 30, 40], sensitivity: 'low' },
            { id: 'create_products', name: 'Create Products', description: 'Add new products', category: 'products', defaultLevels: [1, 10, 20], sensitivity: 'medium' },
            { id: 'edit_products', name: 'Edit Products', description: 'Modify product details', category: 'products', defaultLevels: [1, 10, 20], sensitivity: 'medium' },
            { id: 'delete_products', name: 'Delete Products', description: 'Remove products', category: 'products', defaultLevels: [1, 10], sensitivity: 'high' },
            { id: 'view_product_cost', name: 'View Cost Price', description: 'See product cost prices', category: 'products', defaultLevels: [1, 10, 20], sensitivity: 'critical' },
        ]
    },
    {
        id: 'qr_tracking',
        name: 'QR Tracking',
        icon: QrCode,
        description: 'QR code and journey tracking',
        permissions: [
            { id: 'view_qr_tracking', name: 'View QR Tracking', description: 'Access QR tracking module', category: 'qr_tracking', defaultLevels: [1, 10, 20, 30, 40], sensitivity: 'low' },
            { id: 'scan_qr', name: 'Scan QR Codes', description: 'Scan and verify QR codes', category: 'qr_tracking', defaultLevels: [1, 10, 20, 30, 40], sensitivity: 'low' },
            { id: 'manage_journeys', name: 'Manage Journeys', description: 'Create and edit journey templates', category: 'qr_tracking', defaultLevels: [1, 10, 20, 30], sensitivity: 'medium' },
            { id: 'view_scan_history', name: 'View Scan History', description: 'Access QR scan history', category: 'qr_tracking', defaultLevels: [1, 10, 20, 30], sensitivity: 'medium' },
        ]
    },
    {
        id: 'warehouse',
        name: 'Warehouse Operations',
        icon: Truck,
        description: 'Warehouse receiving and shipping',
        permissions: [
            { id: 'view_warehouse', name: 'View Warehouse', description: 'Access warehouse module', category: 'warehouse', defaultLevels: [1, 10, 20, 30, 40], sensitivity: 'low' },
            { id: 'receive_goods', name: 'Receive Goods', description: 'Process incoming shipments', category: 'warehouse', defaultLevels: [1, 10, 20, 30, 40], sensitivity: 'low' },
            { id: 'ship_goods', name: 'Ship Goods', description: 'Process outgoing shipments', category: 'warehouse', defaultLevels: [1, 10, 20, 30, 40], sensitivity: 'low' },
            { id: 'view_receiving_value', name: 'View Receiving Value', description: 'See values in receiving', category: 'warehouse', defaultLevels: [1, 10, 20, 30], sensitivity: 'medium' },
        ]
    },
    {
        id: 'accounting',
        name: 'Accounting & Finance',
        icon: Wallet,
        description: 'Financial data and accounting features',
        permissions: [
            { id: 'view_accounting', name: 'View Accounting', description: 'Access accounting module', category: 'accounting', defaultLevels: [1, 10, 20], sensitivity: 'high' },
            { id: 'manage_chart_of_accounts', name: 'Manage COA', description: 'Edit chart of accounts', category: 'accounting', defaultLevels: [1, 10, 20], sensitivity: 'critical' },
            { id: 'post_journal_entries', name: 'Post Journal Entries', description: 'Create GL journal entries', category: 'accounting', defaultLevels: [1, 10, 20], sensitivity: 'critical' },
            { id: 'view_gl_reports', name: 'View GL Reports', description: 'Access GL reports', category: 'accounting', defaultLevels: [1, 10, 20], sensitivity: 'high' },
            { id: 'manage_fiscal_years', name: 'Manage Fiscal Years', description: 'Configure fiscal periods', category: 'accounting', defaultLevels: [1, 10, 20], sensitivity: 'critical' },
        ]
    },
    {
        id: 'organizations',
        name: 'Organizations',
        icon: Building2,
        description: 'Organization management',
        permissions: [
            { id: 'view_organizations', name: 'View Organizations', description: 'Access organization list', category: 'organizations', defaultLevels: [1, 10, 20, 30, 40], sensitivity: 'low' },
            { id: 'create_organizations', name: 'Create Organizations', description: 'Add new organizations', category: 'organizations', defaultLevels: [1, 10, 20], sensitivity: 'high' },
            { id: 'edit_organizations', name: 'Edit Organizations', description: 'Modify organization details', category: 'organizations', defaultLevels: [1, 10, 20], sensitivity: 'medium' },
            { id: 'delete_organizations', name: 'Delete Organizations', description: 'Remove organizations', category: 'organizations', defaultLevels: [1], sensitivity: 'critical' },
        ]
    },
    {
        id: 'users',
        name: 'User Management',
        icon: UserCog,
        description: 'User account management',
        permissions: [
            { id: 'view_users', name: 'View Users', description: 'Access user list', category: 'users', defaultLevels: [1, 10, 20], sensitivity: 'medium' },
            { id: 'create_users', name: 'Create Users', description: 'Add new users', category: 'users', defaultLevels: [1, 10, 20], sensitivity: 'high' },
            { id: 'edit_users', name: 'Edit Users', description: 'Modify user details', category: 'users', defaultLevels: [1, 10, 20], sensitivity: 'high' },
            { id: 'delete_users', name: 'Delete Users', description: 'Remove users', category: 'users', defaultLevels: [1, 10], sensitivity: 'critical' },
            { id: 'reset_passwords', name: 'Reset Passwords', description: 'Reset user passwords', category: 'users', defaultLevels: [1], sensitivity: 'critical' },
            { id: 'manage_roles', name: 'Manage Roles', description: 'Assign and modify roles', category: 'users', defaultLevels: [1, 10], sensitivity: 'critical' },
        ]
    },
    {
        id: 'settings',
        name: 'System Settings',
        icon: Settings,
        description: 'System configuration and settings',
        permissions: [
            { id: 'view_settings', name: 'View Settings', description: 'Access settings page', category: 'settings', defaultLevels: [1, 10, 20, 30, 40], sensitivity: 'low' },
            { id: 'edit_org_settings', name: 'Edit Org Settings', description: 'Modify organization settings', category: 'settings', defaultLevels: [1, 10, 20], sensitivity: 'medium' },
            { id: 'manage_org_chart', name: 'Manage Org Chart', description: 'Edit org chart hierarchy and reporting lines', category: 'settings', defaultLevels: [1, 10, 20], sensitivity: 'medium' },
            { id: 'manage_notifications', name: 'Manage Notifications', description: 'Configure notification settings', category: 'settings', defaultLevels: [1, 10, 20], sensitivity: 'medium' },
            { id: 'manage_branding', name: 'Manage Branding', description: 'White-label configuration', category: 'settings', defaultLevels: [1], sensitivity: 'high' },
            { id: 'data_migration', name: 'Data Migration', description: 'Import/Export data', category: 'settings', defaultLevels: [1, 10, 20], sensitivity: 'critical' },
            { id: 'danger_zone', name: 'Danger Zone', description: 'Access dangerous operations', category: 'settings', defaultLevels: [1], sensitivity: 'critical' },
            { id: 'manage_authorization', name: 'Manage Authorization', description: 'Configure role permissions', category: 'settings', defaultLevels: [1], sensitivity: 'critical' },
        ]
    },
]

const ROLE_LEVELS = [
    { level: 1, code: 'SUPERADMIN', name: 'Super Admin', color: 'bg-purple-100 text-purple-800 border-purple-200' },
    { level: 10, code: 'HQ_ADMIN', name: 'HQ Admin', color: 'bg-blue-100 text-blue-800 border-blue-200' },
    { level: 20, code: 'POWER_USER', name: 'Power User', color: 'bg-green-100 text-green-800 border-green-200' },
    { level: 30, code: 'MANAGER', name: 'Manager', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
    { level: 40, code: 'USER', name: 'User', color: 'bg-orange-100 text-orange-800 border-orange-200' },
    { level: 50, code: 'GUEST', name: 'Guest', color: 'bg-gray-100 text-gray-800 border-gray-200' },
]

export default function AuthorizationTab({ userProfile }: AuthorizationTabProps) {
    const { supabase, isReady } = useSupabaseAuth()
    const { hasPermission: hasAuthorizationPermission, loading: permissionsLoading } = usePermissions(
        userProfile.roles.role_level,
        userProfile.role_code,
        userProfile.department_id
    )
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [roles, setRoles] = useState<Role[]>([])
    const [selectedRole, setSelectedRole] = useState<number>(40) // Default to User level
    const [rolePermissions, setRolePermissions] = useState<Record<number, Record<string, boolean>>>({})
    const [hasChanges, setHasChanges] = useState(false)
    const [expandedCategories, setExpandedCategories] = useState<string[]>(['inventory', 'orders'])
    const [scopeMode, setScopeMode] = useState<'role' | 'department'>('role')
    const [departments, setDepartments] = useState<DepartmentAuthorizationRecord[]>([])
    const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null)
    const [departmentOverrides, setDepartmentOverrides] = useState<Record<string, PermissionOverrides>>({})
    const [originalDepartmentOverrides, setOriginalDepartmentOverrides] = useState<Record<string, PermissionOverrides>>({})
    const [deptLoading, setDeptLoading] = useState(false)
    const [deptSaving, setDeptSaving] = useState(false)
    const [referenceRoleLevel, setReferenceRoleLevel] = useState<number>(40)
    const [testerQuery, setTesterQuery] = useState('')
    const [testerUsers, setTesterUsers] = useState<AuthorizationUserOption[]>([])
    const [testerUserId, setTesterUserId] = useState<string>('')
    const [testerPermissionKey, setTesterPermissionKey] = useState('')
    const [testerLoading, setTesterLoading] = useState(false)
    const [testerResult, setTesterResult] = useState<{
        allowed: boolean
        reason: string
        allowedCount: number
        deniedCount: number
    } | null>(null)

    useEffect(() => {
        if (isReady) {
            loadRoles()
        }
    }, [isReady])

    const permissionKeys = useMemo(
        () => PERMISSION_CATEGORIES.flatMap(category => category.permissions.map(perm => perm.id)),
        []
    )

    const canManageAuthorization = userProfile.roles.role_level === 1 || (!permissionsLoading && hasAuthorizationPermission('manage_authorization'))

    useEffect(() => {
        if (isReady && canManageAuthorization) {
            loadDepartments()
        }
    }, [isReady, canManageAuthorization])

    useEffect(() => {
        const handler = setTimeout(async () => {
            if (!canManageAuthorization) return
            const result = await searchAuthorizationUsers(testerQuery)
            if (result.success) {
                setTesterUsers(result.data || [])
                if (!testerUserId && result.data && result.data.length > 0) {
                    setTesterUserId(result.data[0].id)
                }
            }
        }, 250)

        return () => clearTimeout(handler)
    }, [testerQuery, canManageAuthorization, testerUserId])

    const loadRoles = async () => {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('roles')
                .select('*')
                .order('role_level', { ascending: true })

            if (error) throw error

            // Map data to Role type with proper type handling
            const mappedRoles: Role[] = (data || []).map(r => ({
                id: r.id,
                role_code: r.role_code,
                role_name: r.role_name,
                role_level: r.role_level,
                permissions: (r.permissions && typeof r.permissions === 'object' && !Array.isArray(r.permissions))
                    ? r.permissions as Record<string, any>
                    : {},
                is_active: r.is_active ?? true
            }))

            setRoles(mappedRoles)

            // Initialize permissions from database
            const permsMap: Record<number, Record<string, boolean>> = {}
            for (const role of mappedRoles) {
                const dbPerms = role.permissions || {}
                const initPerms: Record<string, boolean> = {}

                // Set permissions based on database or defaults
                for (const category of PERMISSION_CATEGORIES) {
                    for (const perm of category.permissions) {
                        // Use database value if exists, otherwise use default
                        if (dbPerms[perm.id] !== undefined) {
                            initPerms[perm.id] = Boolean(dbPerms[perm.id])
                        } else {
                            initPerms[perm.id] = perm.defaultLevels.includes(role.role_level)
                        }
                    }
                }
                permsMap[role.role_level] = initPerms
            }
            setRolePermissions(permsMap)

        } catch (error: any) {
            console.error('Error loading roles:', error)
            toast({
                title: 'Error',
                description: 'Failed to load roles',
                variant: 'destructive'
            })
        } finally {
            setLoading(false)
        }
    }

    const loadDepartments = async () => {
        try {
            setDeptLoading(true)
            const result = await getAuthorizationDepartments()
            if (!result.success) {
                throw new Error(result.error || 'Failed to load departments')
            }

            const deptList = result.data || []
            setDepartments(deptList)

            const overridesMap: Record<string, PermissionOverrides> = {}
            deptList.forEach(dept => {
                overridesMap[dept.id] = dept.permission_overrides || { allow: [], deny: [] }
            })
            setDepartmentOverrides(overridesMap)
            setOriginalDepartmentOverrides(overridesMap)

            if (!selectedDepartmentId && deptList.length > 0) {
                setSelectedDepartmentId(deptList[0].id)
            }
        } catch (error: any) {
            console.error('Error loading departments:', error)
            toast({
                title: 'Error',
                description: error.message || 'Failed to load departments',
                variant: 'destructive'
            })
        } finally {
            setDeptLoading(false)
        }
    }

    const getDepartmentOverrides = (deptId?: string | null): PermissionOverrides => {
        if (!deptId) return { allow: [], deny: [] }
        return departmentOverrides[deptId] || { allow: [], deny: [] }
    }

    const isOverridesEqual = (a?: PermissionOverrides, b?: PermissionOverrides) => {
        const aAllow = (a?.allow || []).slice().sort()
        const aDeny = (a?.deny || []).slice().sort()
        const bAllow = (b?.allow || []).slice().sort()
        const bDeny = (b?.deny || []).slice().sort()
        return JSON.stringify(aAllow) === JSON.stringify(bAllow) && JSON.stringify(aDeny) === JSON.stringify(bDeny)
    }

    const updateDepartmentOverride = (permissionId: string, enabled: boolean) => {
        if (!selectedDepartmentId) return
        setDepartmentOverrides(prev => {
            const current = prev[selectedDepartmentId] || { allow: [], deny: [] }
            const allowSet = new Set(current.allow)
            const denySet = new Set(current.deny)

            if (enabled) {
                allowSet.add(permissionId)
                denySet.delete(permissionId)
            } else {
                denySet.add(permissionId)
                allowSet.delete(permissionId)
            }

            return {
                ...prev,
                [selectedDepartmentId]: {
                    allow: Array.from(allowSet),
                    deny: Array.from(denySet)
                }
            }
        })
    }

    const saveDepartmentOverrides = async () => {
        if (!selectedDepartmentId) return
        try {
            setDeptSaving(true)
            const overrides = getDepartmentOverrides(selectedDepartmentId)
            const result = await updateDepartmentPermissionOverrides(selectedDepartmentId, overrides)
            if (!result.success) {
                throw new Error(result.error || 'Failed to update department overrides')
            }

            setOriginalDepartmentOverrides(prev => ({
                ...prev,
                [selectedDepartmentId]: overrides
            }))
            toast({ title: 'Success', description: 'Department overrides saved', variant: 'success' })
        } catch (error: any) {
            console.error('Error saving department overrides:', error)
            toast({ title: 'Error', description: error.message || 'Failed to save overrides', variant: 'destructive' })
        } finally {
            setDeptSaving(false)
        }
    }

    const resetDepartmentOverrides = async () => {
        if (!selectedDepartmentId) return
        try {
            setDeptSaving(true)
            const result = await resetDepartmentPermissionOverrides(selectedDepartmentId)
            if (!result.success) {
                throw new Error(result.error || 'Failed to reset department overrides')
            }

            setDepartmentOverrides(prev => ({
                ...prev,
                [selectedDepartmentId]: { allow: [], deny: [] }
            }))
            setOriginalDepartmentOverrides(prev => ({
                ...prev,
                [selectedDepartmentId]: { allow: [], deny: [] }
            }))
            toast({ title: 'Success', description: 'Department overrides cleared', variant: 'success' })
        } catch (error: any) {
            console.error('Error resetting department overrides:', error)
            toast({ title: 'Error', description: error.message || 'Failed to reset overrides', variant: 'destructive' })
        } finally {
            setDeptSaving(false)
        }
    }
    const togglePermission = (roleLevel: number, permissionId: string) => {
        setRolePermissions(prev => {
            const newPerms = { ...prev }
            if (!newPerms[roleLevel]) {
                newPerms[roleLevel] = {}
            }
            newPerms[roleLevel] = {
                ...newPerms[roleLevel],
                [permissionId]: !newPerms[roleLevel][permissionId]
            }
            return newPerms
        })
        setHasChanges(true)
    }

    const savePermissions = async () => {
        try {
            setSaving(true)
            const updates = roles.map(role => ({
                roleId: role.id,
                permissions: rolePermissions[role.role_level] || {}
            }))

            const result = await saveRolePermissions(updates)
            if (!result.success) {
                throw new Error(result.error || 'Failed to update roles')
            }

            toast({
                title: 'Success',
                description: 'Permissions saved successfully',
                variant: 'success'
            })
            setHasChanges(false)

        } catch (error: any) {
            console.error('Error saving permissions:', error)
            toast({
                title: 'Error',
                description: error.message || 'Failed to save permissions',
                variant: 'destructive'
            })
        } finally {
            setSaving(false)
        }
    }

    const resetToDefaults = () => {
        const permsMap: Record<number, Record<string, boolean>> = {}
        for (const role of roles) {
            const initPerms: Record<string, boolean> = {}
            for (const category of PERMISSION_CATEGORIES) {
                for (const perm of category.permissions) {
                    initPerms[perm.id] = perm.defaultLevels.includes(role.role_level)
                }
            }
            permsMap[role.role_level] = initPerms
        }
        setRolePermissions(permsMap)
        setHasChanges(true)
    }

    // ── Module-level quick-set ────────────────────────────────────

    /** Toggle all permissions in a category on or off for the selected role */
    const setCategoryPermissions = (categoryId: string, enabled: boolean) => {
        const cat = PERMISSION_CATEGORIES.find((c) => c.id === categoryId)
        if (!cat) return
        setRolePermissions((prev) => {
            const newPerms = { ...prev }
            if (!newPerms[selectedRole]) newPerms[selectedRole] = {}
            newPerms[selectedRole] = { ...newPerms[selectedRole] }
            for (const perm of cat.permissions) {
                newPerms[selectedRole][perm.id] = enabled
            }
            return newPerms
        })
        setHasChanges(true)
    }

    // ── Preset role templates ─────────────────────────────────────

    interface RolePreset {
        label: string
        description: string
        permissions: Record<string, boolean>
    }

    const ROLE_PRESETS: Record<string, RolePreset> = {
        full_access: {
            label: 'Full Access',
            description: 'Enable all permissions',
            permissions: Object.fromEntries(
                PERMISSION_CATEGORIES.flatMap((c) => c.permissions.map((p) => [p.id, true]))
            ),
        },
        manufacturing: {
            label: 'Manufacturing',
            description: 'QR scanning, products, orders, quality',
            permissions: {
                view_dashboard: true, view_reports: false, export_reports: false,
                view_inventory: false, view_inventory_value: false, view_inventory_cost: false, adjust_stock: false, manage_inventory_settings: false,
                view_orders: true, create_orders: true, approve_orders: false, cancel_orders: false, delete_orders: false, view_order_value: false,
                view_products: true, create_products: false, edit_products: false, delete_products: false, view_product_cost: false,
                view_qr_tracking: true, scan_qr: true, manage_journeys: false, view_scan_history: true,
                view_warehouse: false, receive_goods: false, ship_goods: false, view_receiving_value: false,
                view_accounting: false, manage_chart_of_accounts: false, post_journal_entries: false, view_gl_reports: false, manage_fiscal_years: false,
                view_organizations: false, create_organizations: false, edit_organizations: false, delete_organizations: false,
                view_users: false, create_users: false, edit_users: false, delete_users: false, reset_passwords: false, manage_roles: false,
                view_settings: false, edit_org_settings: false, manage_org_chart: false, manage_notifications: false,
                manage_branding: false, data_migration: false, danger_zone: false, manage_authorization: false,
            },
        },
        warehouse: {
            label: 'Warehouse',
            description: 'Receive/ship, inventory, orders, QR',
            permissions: {
                view_dashboard: true, view_reports: true, export_reports: false,
                view_inventory: true, view_inventory_value: true, view_inventory_cost: false, adjust_stock: true, manage_inventory_settings: false,
                view_orders: true, create_orders: true, approve_orders: false, cancel_orders: false, delete_orders: false, view_order_value: true,
                view_products: true, create_products: false, edit_products: false, delete_products: false, view_product_cost: false,
                view_qr_tracking: true, scan_qr: true, manage_journeys: false, view_scan_history: true,
                view_warehouse: true, receive_goods: true, ship_goods: true, view_receiving_value: true,
                view_accounting: false, manage_chart_of_accounts: false, post_journal_entries: false, view_gl_reports: false, manage_fiscal_years: false,
                view_organizations: false, create_organizations: false, edit_organizations: false, delete_organizations: false,
                view_users: false, create_users: false, edit_users: false, delete_users: false, reset_passwords: false, manage_roles: false,
                view_settings: true, edit_org_settings: false, manage_org_chart: false, manage_notifications: false,
                manage_branding: false, data_migration: false, danger_zone: false, manage_authorization: false,
            },
        },
        shop_user: {
            label: 'Shop / Retail',
            description: 'Orders, products, basic dashboard',
            permissions: {
                view_dashboard: true, view_reports: false, export_reports: false,
                view_inventory: true, view_inventory_value: false, view_inventory_cost: false, adjust_stock: false, manage_inventory_settings: false,
                view_orders: true, create_orders: true, approve_orders: false, cancel_orders: false, delete_orders: false, view_order_value: false,
                view_products: true, create_products: false, edit_products: false, delete_products: false, view_product_cost: false,
                view_qr_tracking: true, scan_qr: true, manage_journeys: false, view_scan_history: false,
                view_warehouse: false, receive_goods: false, ship_goods: false, view_receiving_value: false,
                view_accounting: false, manage_chart_of_accounts: false, post_journal_entries: false, view_gl_reports: false, manage_fiscal_years: false,
                view_organizations: false, create_organizations: false, edit_organizations: false, delete_organizations: false,
                view_users: false, create_users: false, edit_users: false, delete_users: false, reset_passwords: false, manage_roles: false,
                view_settings: true, edit_org_settings: false, manage_org_chart: false, manage_notifications: false,
                manage_branding: false, data_migration: false, danger_zone: false, manage_authorization: false,
            },
        },
        view_only: {
            label: 'View Only',
            description: 'Read-only access to basic features',
            permissions: {
                view_dashboard: true, view_reports: false, export_reports: false,
                view_inventory: true, view_inventory_value: false, view_inventory_cost: false, adjust_stock: false, manage_inventory_settings: false,
                view_orders: true, create_orders: false, approve_orders: false, cancel_orders: false, delete_orders: false, view_order_value: false,
                view_products: true, create_products: false, edit_products: false, delete_products: false, view_product_cost: false,
                view_qr_tracking: true, scan_qr: false, manage_journeys: false, view_scan_history: false,
                view_warehouse: true, receive_goods: false, ship_goods: false, view_receiving_value: false,
                view_accounting: false, manage_chart_of_accounts: false, post_journal_entries: false, view_gl_reports: false, manage_fiscal_years: false,
                view_organizations: true, create_organizations: false, edit_organizations: false, delete_organizations: false,
                view_users: false, create_users: false, edit_users: false, delete_users: false, reset_passwords: false, manage_roles: false,
                view_settings: true, edit_org_settings: false, manage_org_chart: false, manage_notifications: false,
                manage_branding: false, data_migration: false, danger_zone: false, manage_authorization: false,
            },
        },
        no_access: {
            label: 'No Access',
            description: 'Disable all permissions',
            permissions: Object.fromEntries(
                PERMISSION_CATEGORIES.flatMap((c) => c.permissions.map((p) => [p.id, false]))
            ),
        },
    }

    const applyPreset = (presetKey: string) => {
        const preset = ROLE_PRESETS[presetKey]
        if (!preset) return
        setRolePermissions((prev) => ({
            ...prev,
            [selectedRole]: { ...(prev[selectedRole] || {}), ...preset.permissions },
        }))
        setHasChanges(true)
        toast({
            title: 'Preset Applied',
            description: `"${preset.label}" applied to ${ROLE_LEVELS.find((r) => r.level === selectedRole)?.name || 'role'}`,
        })
    }

    const getSensitivityBadge = (sensitivity: string) => {
        const styles = {
            low: 'bg-green-50 text-green-700 border-green-200',
            medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
            high: 'bg-orange-50 text-orange-700 border-orange-200',
            critical: 'bg-red-50 text-red-700 border-red-200'
        }
        return styles[sensitivity as keyof typeof styles] || styles.low
    }

    const getPermissionStatus = (permId: string, roleLevel: number) => {
        return rolePermissions[roleLevel]?.[permId] ?? false
    }

    const selectedDepartment = departments.find(dept => dept.id === selectedDepartmentId) || null
    const selectedDeptOverrides = getDepartmentOverrides(selectedDepartmentId)
    const selectedDeptOriginal = selectedDepartmentId ? originalDepartmentOverrides[selectedDepartmentId] : undefined
    const hasDeptChanges = selectedDepartmentId
        ? !isOverridesEqual(selectedDeptOverrides, selectedDeptOriginal)
        : false

    const selectedTesterUser = testerUsers.find(user => user.id === testerUserId) || null

    const runPermissionTest = async () => {
        if (!testerUserId || !testerPermissionKey) return
        try {
            setTesterLoading(true)
            const result = await testPermissionAccess(testerUserId, testerPermissionKey)
            if (!result.success) {
                throw new Error(result.error || 'Failed to test permission')
            }
            setTesterResult(result.data)
        } catch (error: any) {
            console.error('Permission test error:', error)
            toast({
                title: 'Error',
                description: error.message || 'Failed to test permission',
                variant: 'destructive'
            })
        } finally {
            setTesterLoading(false)
        }
    }

    const isSuperAdmin = userProfile.roles.role_level === 1
    const isAuthorized = canManageAuthorization

    if (permissionsLoading) {
        return (
            <Card>
                <CardContent className="py-12 text-center">
                    <RefreshCw className="w-8 h-8 mx-auto text-blue-600 animate-spin mb-4" />
                    <p className="text-gray-600">Checking permissions...</p>
                </CardContent>
            </Card>
        )
    }

    if (!isAuthorized) {
        return (
            <Card>
                <CardContent className="py-12 text-center">
                    <Lock className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Restricted</h3>
                    <p className="text-gray-600">You need the Manage Authorization permission to access this page.</p>
                </CardContent>
            </Card>
        )
    }

    if (loading || (scopeMode === 'department' && deptLoading)) {
        return (
            <Card>
                <CardContent className="py-12 text-center">
                    <RefreshCw className="w-8 h-8 mx-auto text-blue-600 animate-spin mb-4" />
                    <p className="text-gray-600">Loading authorization settings...</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <Tabs value={scopeMode} onValueChange={(value) => setScopeMode(value as 'role' | 'department')}>
            <div className="space-y-6">
                {/* Header */}
                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                                    <Shield className="w-5 h-5 text-purple-600" />
                                </div>
                                <div>
                                    <CardTitle>Authorization Management</CardTitle>
                                    <CardDescription>
                                        Configure role-based access control for all system features
                                    </CardDescription>
                                </div>
                            </div>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                                <TabsList>
                                    <TabsTrigger value="role">Role</TabsTrigger>
                                    <TabsTrigger value="department">Department</TabsTrigger>
                                </TabsList>
                                {scopeMode === 'role' ? (
                                    <div className="flex gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={resetToDefaults}
                                            disabled={saving}
                                        >
                                            <RefreshCw className="w-4 h-4 mr-2" />
                                            Reset to Defaults
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={savePermissions}
                                            disabled={saving || !hasChanges}
                                            className="bg-blue-600 hover:bg-blue-700"
                                        >
                                            <Save className="w-4 h-4 mr-2" />
                                            {saving ? 'Saving...' : 'Save Changes'}
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex gap-2">
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="outline" size="sm" disabled={deptSaving || !selectedDepartmentId}>
                                                    <RefreshCw className="w-4 h-4 mr-2" />
                                                    Reset to Defaults
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Reset overrides?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        This will clear all allow/deny overrides for the selected department.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                    <AlertDialogAction onClick={resetDepartmentOverrides}>Reset</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                        <Button
                                            size="sm"
                                            onClick={saveDepartmentOverrides}
                                            disabled={deptSaving || !hasDeptChanges}
                                            className="bg-blue-600 hover:bg-blue-700"
                                        >
                                            <Save className="w-4 h-4 mr-2" />
                                            {deptSaving ? 'Saving...' : 'Save Changes'}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                </Card>

                <TabsContent value="role" className="space-y-6">
                    {/* Role Selection & Permission Matrix */}
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                        {/* Role Selection Panel */}
                        <Card className="lg:col-span-1">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">User Roles</CardTitle>
                                <CardDescription className="text-xs">
                                    Select a role to configure
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {ROLE_LEVELS.map((role) => (
                                    <button
                                        key={role.level}
                                        onClick={() => setSelectedRole(role.level)}
                                        className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${selectedRole === role.level
                                            ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${role.color}`}>
                                                {role.level}
                                            </div>
                                            <div className="text-left">
                                                <div className="font-medium text-sm">{role.name}</div>
                                                <div className="text-xs text-gray-500">Level {role.level}</div>
                                            </div>
                                        </div>
                                        {selectedRole === role.level && (
                                            <CheckCircle className="w-4 h-4 text-blue-600" />
                                        )}
                                    </button>
                                ))}
                            </CardContent>
                        </Card>

                        {/* Permissions Panel */}
                        <Card className="lg:col-span-3">
                            <CardHeader className="pb-3 border-b">
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <CardTitle className="text-base flex items-center gap-2">
                                                Permissions for {ROLE_LEVELS.find(r => r.level === selectedRole)?.name}
                                                <Badge variant="outline" className={ROLE_LEVELS.find(r => r.level === selectedRole)?.color}>
                                                    Level {selectedRole}
                                                </Badge>
                                            </CardTitle>
                                            <CardDescription className="text-xs mt-1">
                                                Toggle permissions for this role. Changes apply to all users with this role.
                                            </CardDescription>
                                        </div>
                                        {hasChanges && (
                                            <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                                                <AlertCircle className="w-3 h-3 mr-1" />
                                                Unsaved Changes
                                            </Badge>
                                        )}
                                    </div>

                                    {/* ── Quick Presets ── */}
                                    <div className="flex flex-wrap gap-1.5">
                                        <span className="text-xs text-gray-500 self-center mr-1">Quick Presets:</span>
                                        {Object.entries(ROLE_PRESETS).map(([key, preset]) => (
                                            <TooltipProvider key={key}>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-7 text-xs px-2.5"
                                                            onClick={() => applyPreset(key)}
                                                        >
                                                            {preset.label}
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent><p className="text-xs">{preset.description}</p></TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        ))}
                                    </div>

                                    {/* ── Access Summary Strip ── */}
                                    <div className="flex flex-wrap gap-2">
                                        {PERMISSION_CATEGORIES.map((cat) => {
                                            const enabled = cat.permissions.filter(p => getPermissionStatus(p.id, selectedRole)).length
                                            const total = cat.permissions.length
                                            const pct = Math.round((enabled / total) * 100)
                                            const color = pct === 100 ? 'bg-green-100 text-green-800 border-green-200'
                                                : pct > 0 ? 'bg-blue-50 text-blue-700 border-blue-200'
                                                    : 'bg-gray-50 text-gray-500 border-gray-200'
                                            return (
                                                <button
                                                    key={cat.id}
                                                    onClick={() => {
                                                        setExpandedCategories(prev =>
                                                            prev.includes(cat.id) ? prev : [...prev, cat.id]
                                                        )
                                                        // Scroll category into view
                                                        setTimeout(() => {
                                                            document.getElementById(`cat-${cat.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                                                        }, 150)
                                                    }}
                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs transition-colors hover:ring-1 hover:ring-blue-300 ${color}`}
                                                >
                                                    {cat.name.split(' ')[0]}
                                                    <span className="font-semibold">{enabled}/{total}</span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Accordion type="multiple" value={expandedCategories} onValueChange={setExpandedCategories}>
                                    {PERMISSION_CATEGORIES.map((category) => {
                                        const Icon = category.icon
                                        const enabledCount = category.permissions.filter(
                                            p => getPermissionStatus(p.id, selectedRole)
                                        ).length
                                        const allOn = enabledCount === category.permissions.length
                                        const allOff = enabledCount === 0

                                        return (
                                            <AccordionItem key={category.id} value={category.id} id={`cat-${category.id}`} className="border-b last:border-b-0">
                                                <AccordionTrigger className="px-4 py-3 hover:bg-gray-50 hover:no-underline">
                                                    <div className="flex items-center gap-3 w-full">
                                                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                                                            <Icon className="w-4 h-4 text-gray-600" />
                                                        </div>
                                                        <div className="flex-1 text-left">
                                                            <div className="font-medium text-sm">{category.name}</div>
                                                            <div className="text-xs text-gray-500">{category.description}</div>
                                                        </div>
                                                        <Badge variant="outline" className="mr-2">
                                                            {enabledCount}/{category.permissions.length}
                                                        </Badge>
                                                    </div>
                                                </AccordionTrigger>
                                                <AccordionContent>
                                                    {/* Category-level quick toggles */}
                                                    <div className="px-4 pt-2 pb-1 flex items-center gap-2">
                                                        <span className="text-xs text-gray-500">Quick:</span>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-6 text-xs px-2"
                                                            disabled={allOn}
                                                            onClick={(e) => { e.stopPropagation(); setCategoryPermissions(category.id, true) }}
                                                        >
                                                            All On
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-6 text-xs px-2"
                                                            disabled={allOff}
                                                            onClick={(e) => { e.stopPropagation(); setCategoryPermissions(category.id, false) }}
                                                        >
                                                            All Off
                                                        </Button>
                                                    </div>
                                                    <div className="px-4 pb-4 pt-2 space-y-3">
                                                        {category.permissions.map((permission) => (
                                                            <div
                                                                key={permission.id}
                                                                className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100"
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <TooltipProvider>
                                                                        <Tooltip>
                                                                            <TooltipTrigger asChild>
                                                                                <Badge
                                                                                    variant="outline"
                                                                                    className={`text-xs ${getSensitivityBadge(permission.sensitivity)}`}
                                                                                >
                                                                                    {permission.sensitivity === 'critical' && <Lock className="w-3 h-3 mr-1" />}
                                                                                    {permission.sensitivity}
                                                                                </Badge>
                                                                            </TooltipTrigger>
                                                                            <TooltipContent>
                                                                                <p className="text-xs">Data sensitivity level</p>
                                                                            </TooltipContent>
                                                                        </Tooltip>
                                                                    </TooltipProvider>
                                                                    <div>
                                                                        <div className="font-medium text-sm">{permission.name}</div>
                                                                        <div className="text-xs text-gray-500">{permission.description}</div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-3">
                                                                    <Switch
                                                                        checked={getPermissionStatus(permission.id, selectedRole)}
                                                                        onCheckedChange={() => togglePermission(selectedRole, permission.id)}
                                                                        className="data-[state=checked]:bg-blue-600"
                                                                    />
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </AccordionContent>
                                            </AccordionItem>
                                        )
                                    })}
                                </Accordion>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Full Permission Matrix */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Permission Matrix</CardTitle>
                            <CardDescription>Interactive view of all permissions across roles. Click a cell to toggle.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="text-left py-2 px-3 font-medium text-gray-600 w-48 sticky left-0 bg-white z-10">Permission</th>
                                            {ROLE_LEVELS.map(role => (
                                                <th key={role.level} className="text-center py-2 px-2 font-medium min-w-[72px]">
                                                    <div className="flex flex-col items-center gap-1">
                                                        <Badge variant="outline" className={`text-xs ${role.color}`}>
                                                            L{role.level}
                                                        </Badge>
                                                        <span className="text-xs text-gray-500 whitespace-nowrap">{role.name}</span>
                                                    </div>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {PERMISSION_CATEGORIES.map(category => (
                                            <React.Fragment key={category.id}>
                                                {/* Category header row */}
                                                <tr className="bg-gray-50">
                                                    <td colSpan={ROLE_LEVELS.length + 1} className="py-1.5 px-3 sticky left-0 bg-gray-50 z-10">
                                                        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{category.name}</span>
                                                    </td>
                                                </tr>
                                                {category.permissions.map((perm) => (
                                                    <tr key={perm.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                                                        <td className="py-1.5 px-3 sticky left-0 bg-white z-10">
                                                            <span className="text-sm">{perm.name}</span>
                                                        </td>
                                                        {ROLE_LEVELS.map(role => {
                                                            const enabled = getPermissionStatus(perm.id, role.level)
                                                            return (
                                                                <td key={role.level} className="text-center py-1.5 px-2">
                                                                    <button
                                                                        onClick={() => togglePermission(role.level, perm.id)}
                                                                        className="mx-auto block p-0.5 rounded hover:bg-gray-200 transition-colors"
                                                                        title={`${perm.name} → ${role.name}: ${enabled ? 'ON' : 'OFF'}`}
                                                                    >
                                                                        {enabled ? (
                                                                            <CheckCircle className="w-4 h-4 text-green-600" />
                                                                        ) : (
                                                                            <EyeOff className="w-4 h-4 text-gray-300" />
                                                                        )}
                                                                    </button>
                                                                </td>
                                                            )
                                                        })}
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Quick Reference */}
                    <Card className="bg-blue-50 border-blue-200">
                        <CardContent className="py-4">
                            <div className="flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                                <div className="text-sm text-blue-900">
                                    <p className="font-semibold mb-2">Quick Reference</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-1 gap-x-6 text-blue-800">
                                        {ROLE_LEVELS.map(role => (
                                            <span key={role.level} className="text-xs">
                                                <strong>L{role.level} {role.name}</strong>
                                                {' — '}
                                                {(() => {
                                                    const total = PERMISSION_CATEGORIES.flatMap(c => c.permissions).length
                                                    const enabled = PERMISSION_CATEGORIES.flatMap(c => c.permissions).filter(p => getPermissionStatus(p.id, role.level)).length
                                                    return `${enabled}/${total} permissions`
                                                })()}
                                            </span>
                                        ))}
                                    </div>
                                    <p className="mt-2 text-xs text-blue-700">
                                        Menu visibility also depends on <strong>Organisation Type</strong> (HQ / Manufacturer / Distributor / Warehouse / Shop).
                                        Permissions only control feature access <em>within</em> visible modules. Changes take effect after saving.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="department" className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                        <Card className="lg:col-span-1">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Departments</CardTitle>
                                <CardDescription className="text-xs">Select a department to override</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                {departments.length === 0 && (
                                    <p className="text-xs text-gray-500">No departments found.</p>
                                )}
                                {departments.map((dept) => (
                                    <button
                                        key={dept.id}
                                        onClick={() => setSelectedDepartmentId(dept.id)}
                                        className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${selectedDepartmentId === dept.id
                                            ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                            }`}
                                    >
                                        <div className="text-left">
                                            <div className="font-medium text-sm">{dept.dept_code || 'DEPT'}</div>
                                            <div className="text-xs text-gray-500">{dept.dept_name}</div>
                                        </div>
                                        {selectedDepartmentId === dept.id && (
                                            <CheckCircle className="w-4 h-4 text-blue-600" />
                                        )}
                                    </button>
                                ))}
                            </CardContent>
                        </Card>

                        <Card className="lg:col-span-3">
                            <CardHeader className="pb-3 border-b">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <CardTitle className="text-base">Department Overrides</CardTitle>
                                        <CardDescription className="text-xs mt-1">
                                            {selectedDepartment ? `${selectedDepartment.dept_code || 'DEPT'} - ${selectedDepartment.dept_name}` : 'Select a department'}
                                        </CardDescription>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-gray-500">Reference Role</span>
                                        <Select value={String(referenceRoleLevel)} onValueChange={(value) => setReferenceRoleLevel(Number(value))}>
                                            <SelectTrigger className="w-[180px]">
                                                <SelectValue placeholder="Select role" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {roles.map(role => (
                                                    <SelectItem key={role.id} value={String(role.role_level)}>
                                                        {role.role_name} (L{role.role_level})
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Accordion type="multiple" value={expandedCategories} onValueChange={setExpandedCategories}>
                                    {PERMISSION_CATEGORIES.map((category) => {
                                        const Icon = category.icon
                                        const enabledCount = category.permissions.filter(permission => {
                                            const inherited = rolePermissions[referenceRoleLevel]?.[permission.id] ?? false
                                            const overrideAllow = selectedDeptOverrides.allow.includes(permission.id)
                                            const overrideDeny = selectedDeptOverrides.deny.includes(permission.id)
                                            return overrideDeny ? false : overrideAllow ? true : inherited
                                        }).length

                                        return (
                                            <AccordionItem key={category.id} value={category.id} className="border-b last:border-b-0">
                                                <AccordionTrigger className="px-4 py-3 hover:bg-gray-50 hover:no-underline">
                                                    <div className="flex items-center gap-3 w-full">
                                                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                                                            <Icon className="w-4 h-4 text-gray-600" />
                                                        </div>
                                                        <div className="flex-1 text-left">
                                                            <div className="font-medium text-sm">{category.name}</div>
                                                            <div className="text-xs text-gray-500">{category.description}</div>
                                                        </div>
                                                        <Badge variant="outline" className="mr-2">
                                                            {enabledCount}/{category.permissions.length}
                                                        </Badge>
                                                    </div>
                                                </AccordionTrigger>
                                                <AccordionContent>
                                                    <div className="px-4 pb-4 pt-2 space-y-3">
                                                        {category.permissions.map((permission) => {
                                                            const inherited = rolePermissions[referenceRoleLevel]?.[permission.id] ?? false
                                                            const overrideAllow = selectedDeptOverrides.allow.includes(permission.id)
                                                            const overrideDeny = selectedDeptOverrides.deny.includes(permission.id)
                                                            const effective = overrideDeny ? false : overrideAllow ? true : inherited

                                                            return (
                                                                <div
                                                                    key={permission.id}
                                                                    className="flex flex-col gap-2 rounded-lg bg-gray-50 border border-gray-100 p-3"
                                                                >
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="flex items-center gap-3">
                                                                            <TooltipProvider>
                                                                                <Tooltip>
                                                                                    <TooltipTrigger asChild>
                                                                                        <Badge
                                                                                            variant="outline"
                                                                                            className={`text-xs ${getSensitivityBadge(permission.sensitivity)}`}
                                                                                        >
                                                                                            {permission.sensitivity === 'critical' && <Lock className="w-3 h-3 mr-1" />}
                                                                                            {permission.sensitivity}
                                                                                        </Badge>
                                                                                    </TooltipTrigger>
                                                                                    <TooltipContent>
                                                                                        <p className="text-xs">Data sensitivity level</p>
                                                                                    </TooltipContent>
                                                                                </Tooltip>
                                                                            </TooltipProvider>
                                                                            <div>
                                                                                <div className="font-medium text-sm">{permission.name}</div>
                                                                                <div className="text-xs text-gray-500">{permission.description}</div>
                                                                            </div>
                                                                        </div>
                                                                        <Switch
                                                                            checked={effective}
                                                                            onCheckedChange={(checked) => updateDepartmentOverride(permission.id, checked)}
                                                                            className="data-[state=checked]:bg-blue-600"
                                                                            disabled={!selectedDepartmentId}
                                                                        />
                                                                    </div>
                                                                    <div className="flex flex-wrap gap-2 text-xs">
                                                                        {overrideAllow && (
                                                                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                                                                Override ALLOW
                                                                            </Badge>
                                                                        )}
                                                                        {overrideDeny && (
                                                                            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                                                                                Override DENY
                                                                            </Badge>
                                                                        )}
                                                                        {!overrideAllow && !overrideDeny && (
                                                                            <Badge variant="outline" className={inherited ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-gray-50 text-gray-600 border-gray-200'}>
                                                                                Inherited {inherited ? 'ON' : 'OFF'}
                                                                            </Badge>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </AccordionContent>
                                            </AccordionItem>
                                        )
                                    })}
                                </Accordion>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Test Access</CardTitle>
                            <CardDescription>Check effective permissions for any user</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-gray-600">Search User</label>
                                    <Input
                                        value={testerQuery}
                                        onChange={(event) => setTesterQuery(event.target.value)}
                                        placeholder="Search by name or email"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-gray-600">Select User</label>
                                    <Select value={testerUserId} onValueChange={setTesterUserId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select user" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {testerUsers.map(user => (
                                                <SelectItem key={user.id} value={user.id}>
                                                    {user.full_name || user.email}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-gray-600">Permission Key</label>
                                    <Input
                                        list="permission-keys"
                                        value={testerPermissionKey}
                                        onChange={(event) => setTesterPermissionKey(event.target.value)}
                                        placeholder="e.g. view_orders"
                                    />
                                    <datalist id="permission-keys">
                                        {permissionKeys.map(key => (
                                            <option key={key} value={key} />
                                        ))}
                                    </datalist>
                                </div>
                            </div>

                            {selectedTesterUser && (
                                <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                                    <span>Role: {selectedTesterUser.role_code || 'N/A'} (L{selectedTesterUser.role_level ?? '--'})</span>
                                    <span>Department: {selectedTesterUser.department?.dept_name || 'None'}</span>
                                </div>
                            )}

                            <div className="flex items-center gap-3">
                                <Button
                                    size="sm"
                                    onClick={runPermissionTest}
                                    disabled={!testerUserId || !testerPermissionKey || testerLoading}
                                >
                                    {testerLoading ? 'Testing...' : 'Test Access'}
                                </Button>
                                {testerResult && (
                                    <div className={`text-sm font-medium ${testerResult.allowed ? 'text-green-700' : 'text-red-700'}`}>
                                        {testerResult.allowed ? 'Allowed' : 'Denied'}
                                    </div>
                                )}
                            </div>

                            {testerResult && (
                                <div className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm lg:grid-cols-3">
                                    <div>
                                        <div className="text-xs text-gray-500">Reason</div>
                                        <div className="font-medium text-gray-800">{testerResult.reason}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-gray-500">Allowed Keys</div>
                                        <div className="font-medium text-gray-800">{testerResult.allowedCount}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs text-gray-500">Denied Keys</div>
                                        <div className="font-medium text-gray-800">{testerResult.deniedCount}</div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </div>
        </Tabs>
    )
}
