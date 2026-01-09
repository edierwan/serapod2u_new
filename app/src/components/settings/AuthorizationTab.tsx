'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { toast } from '@/components/ui/use-toast'
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
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [roles, setRoles] = useState<Role[]>([])
    const [selectedRole, setSelectedRole] = useState<number>(40) // Default to User level
    const [rolePermissions, setRolePermissions] = useState<Record<number, Record<string, boolean>>>({})
    const [hasChanges, setHasChanges] = useState(false)
    const [expandedCategories, setExpandedCategories] = useState<string[]>(['inventory', 'orders'])

    useEffect(() => {
        if (isReady) {
            loadRoles()
        }
    }, [isReady])

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
            let updateCount = 0

            for (const role of roles) {
                const permissions = rolePermissions[role.role_level] || {}

                console.log(`[savePermissions] Saving role ${role.role_level} permissions:`, permissions)

                const { data, error } = await supabase
                    .from('roles')
                    .update({
                        permissions
                    })
                    .eq('id', role.id)
                    .select()

                if (error) {
                    console.error(`[savePermissions] Error updating role ${role.role_level}:`, error)
                    throw error
                }
                
                // Check if update actually happened (RLS might block it)
                console.log(`[savePermissions] Role ${role.role_level} update result:`, data)
                if (data && data.length > 0) {
                    updateCount++
                } else {
                    throw new Error(`Failed to update role ${role.role_name}. You may not have permission to modify roles.`)
                }
            }
            
            if (updateCount === 0) {
                throw new Error('No roles were updated. You may not have permission to modify roles.')
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

    const isSuperAdmin = userProfile.roles.role_level === 1

    if (!isSuperAdmin) {
        return (
            <Card>
                <CardContent className="py-12 text-center">
                    <Lock className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Access Restricted</h3>
                    <p className="text-gray-600">Only Super Admins can manage authorization settings.</p>
                </CardContent>
            </Card>
        )
    }

    if (loading) {
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
        <div className="space-y-6">
            {/* Header */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
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
                    </div>
                </CardHeader>
            </Card>

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
                    </CardHeader>
                    <CardContent className="p-0">
                        <Accordion type="multiple" value={expandedCategories} onValueChange={setExpandedCategories}>
                            {PERMISSION_CATEGORIES.map((category) => {
                                const Icon = category.icon
                                const enabledCount = category.permissions.filter(
                                    p => getPermissionStatus(p.id, selectedRole)
                                ).length

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

            {/* Permission Matrix Overview */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Permission Matrix Overview</CardTitle>
                    <CardDescription>Quick view of all permissions across roles</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-2 px-3 font-medium text-gray-600 w-48">Permission</th>
                                    {ROLE_LEVELS.map(role => (
                                        <th key={role.level} className="text-center py-2 px-2 font-medium">
                                            <div className="flex flex-col items-center gap-1">
                                                <Badge variant="outline" className={`text-xs ${role.color}`}>
                                                    L{role.level}
                                                </Badge>
                                                <span className="text-xs text-gray-500">{role.name}</span>
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {PERMISSION_CATEGORIES.flatMap(category =>
                                    category.permissions.slice(0, 3).map((perm, idx) => (
                                        <tr key={perm.id} className={idx === 0 ? 'border-t-2 border-gray-200' : ''}>
                                            <td className="py-2 px-3">
                                                <div className="flex items-center gap-2">
                                                    {idx === 0 && (
                                                        <span className="text-xs text-gray-400 font-medium">{category.name}:</span>
                                                    )}
                                                    <span className={idx === 0 ? 'font-medium' : ''}>{perm.name}</span>
                                                </div>
                                            </td>
                                            {ROLE_LEVELS.map(role => (
                                                <td key={role.level} className="text-center py-2 px-2">
                                                    {getPermissionStatus(perm.id, role.level) ? (
                                                        <CheckCircle className="w-4 h-4 text-green-600 mx-auto" />
                                                    ) : (
                                                        <EyeOff className="w-4 h-4 text-gray-300 mx-auto" />
                                                    )}
                                                </td>
                                            ))}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-xs text-gray-500 mt-4 text-center">
                        Showing top 3 permissions per category. Use the panel above for complete control.
                    </p>
                </CardContent>
            </Card>

            {/* Information Card */}
            <Card className="bg-blue-50 border-blue-200">
                <CardContent className="py-4">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-blue-900">
                            <p className="font-semibold mb-1">How Authorization Works</p>
                            <ul className="space-y-1 text-blue-800">
                                <li>• <strong>Super Admin (Level 1)</strong> has full access to all features including this settings page</li>
                                <li>• <strong>HQ Admin (Level 10)</strong> can manage most organizational settings</li>
                                <li>• <strong>Power User (Level 20)</strong> has access to accounting and advanced features</li>
                                <li>• <strong>Manager (Level 30)</strong> can approve orders and manage teams</li>
                                <li>• <strong>User (Level 40)</strong> has standard operational access</li>
                                <li>• <strong>Guest (Level 50)</strong> has read-only access to basic features</li>
                            </ul>
                            <p className="mt-2 text-blue-700">
                                Changes to permissions take effect immediately after saving. Users may need to refresh their browser to see updated access.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
