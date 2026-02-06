'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useToast } from '@/components/ui/use-toast'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle
} from '@/components/ui/sheet'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    Building2,
    Users,
    Network,
    Loader2,
    ChevronDown,
    ChevronRight,
    UserCircle,
    Edit,
    ZoomIn,
    ZoomOut,
    Maximize2,
    RefreshCw,
    GripVertical
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    getDepartmentHierarchy,
    getDepartmentMembers,
    getUserOrgChart,
    listDepartments,
    getUsersForOrgPicker,
    updateDepartmentChart,
    reorderDepartmentWithinParent,
    type DepartmentHierarchyNode,
    type DepartmentMember,
    type UserOrgChartNode,
    type Department
} from '@/lib/actions/departments'
import { fetchHrPositions, updateUserHr } from '@/lib/api/hr'

interface OrgChartTabProps {
    organizationId: string
    canEdit: boolean
    onNavigateToDepartment?: (deptId: string) => void
}

// ============================================================================
// Department Node Component
// ============================================================================

interface DepartmentNodeProps {
    node: DepartmentHierarchyNode
    isEditMode: boolean
    highlightedId?: string | null
    onNodeClick?: (node: DepartmentHierarchyNode) => void
    onEditClick?: (node: DepartmentHierarchyNode) => void
    level: number
}

function DepartmentNode({
    node,
    isEditMode,
    highlightedId,
    onNodeClick,
    onEditClick,
    level
}: DepartmentNodeProps) {
    const [isExpanded, setIsExpanded] = useState(level < 2) // Auto-expand first 2 levels
    const hasChildren = node.children && node.children.length > 0
    const isHighlighted = highlightedId === node.id

    return (
        <div className="flex flex-col items-center">
            {/* Node Card */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: level * 0.1 }}
                className={`
          relative min-w-[200px] max-w-[280px] bg-white border-2 rounded-lg shadow-md
          transition-all duration-200 cursor-pointer
          ${isHighlighted
                        ? 'border-blue-500 ring-2 ring-blue-200'
                        : 'border-gray-200 hover:border-blue-300 hover:shadow-lg'
                    }
          ${!node.is_active ? 'opacity-60' : ''}
        `}
                onClick={() => onNodeClick?.(node)}
            >
                {/* Department Header */}
                <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-3 py-2 rounded-t-md flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Building2 className="h-4 w-4 flex-shrink-0" />
                        <span className="font-medium text-sm truncate">{node.dept_name}</span>
                    </div>
                    {node.dept_code && (
                        <Badge variant="secondary" className="bg-white/20 text-white text-xs ml-2">
                            {node.dept_code}
                        </Badge>
                    )}
                </div>

                {/* Department Content */}
                <div className="p-3 space-y-2">
                    {Number.isFinite(node.depth) && (
                        <Badge variant="outline" className="text-xs text-blue-600 border-blue-200">
                            Level {node.depth + 1}
                        </Badge>
                    )}

                    {/* Manager */}
                    <div className="flex items-center gap-2 text-sm">
                        {node.manager_name ? (
                            <Avatar className="h-6 w-6">
                                <AvatarImage src={node.manager_avatar_url || undefined} alt={node.manager_name} />
                                <AvatarFallback>
                                    {node.manager_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                            </Avatar>
                        ) : (
                            <UserCircle className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        )}
                        <div className="flex flex-col min-w-0">
                            <span className="text-gray-600 truncate">
                                {node.manager_name || 'No manager assigned'}
                            </span>
                            {node.manager_position_name && (
                                <span className="text-xs text-gray-400 truncate">{node.manager_position_name}</span>
                            )}
                        </div>
                    </div>
                    {!node.manager_name && isEditMode && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation()
                                onEditClick?.(node)
                            }}
                            className="text-xs text-blue-600 hover:underline text-left"
                        >
                            Assign manager
                        </button>
                    )}

                    {/* User Count */}
                    <div className="flex items-center gap-2 text-sm">
                        <Users className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <span className="text-gray-600">{node.user_count} member{node.user_count !== 1 ? 's' : ''}</span>
                    </div>
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            onNodeClick?.(node)
                        }}
                        className="text-xs text-blue-600 hover:underline text-left"
                    >
                        View members
                    </button>

                    {/* Status Badge */}
                    {!node.is_active && (
                        <Badge variant="secondary" className="bg-gray-100 text-gray-600 text-xs">
                            Disabled
                        </Badge>
                    )}
                </div>

                {/* Edit Button (Edit Mode) */}
                {isEditMode && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            onEditClick?.(node)
                        }}
                        className="absolute -top-2 -right-2 p-1.5 bg-blue-500 text-white rounded-full shadow hover:bg-blue-600 transition-colors"
                    >
                        <Edit className="h-3 w-3" />
                    </button>
                )}

                {/* Drag Handle (Edit Mode) */}
                {isEditMode && (
                    <div className="absolute -left-2 top-1/2 -translate-y-1/2 p-1 bg-gray-100 rounded cursor-grab hover:bg-gray-200">
                        <GripVertical className="h-4 w-4 text-gray-400" />
                    </div>
                )}
            </motion.div>

            {/* Connector Line to Children */}
            {hasChildren && (
                <>
                    {/* Toggle Button */}
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="mt-1 p-1 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                        {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-gray-500" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-gray-500" />
                        )}
                    </button>

                    {/* Vertical Line */}
                    <AnimatePresence>
                        {isExpanded && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 20, opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="w-px bg-gray-300"
                            />
                        )}
                    </AnimatePresence>
                </>
            )}

            {/* Children */}
            <AnimatePresence>
                {hasChildren && isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex flex-col items-center"
                    >
                        {/* Horizontal connector */}
                        {node.children && node.children.length > 1 && (
                            <div className="flex items-start">
                                <div className="flex">
                                    {node.children.map((_, idx) => (
                                        <div key={idx} className="flex flex-col items-center">
                                            {idx === 0 && <div className="h-px w-1/2 bg-transparent" />}
                                            {idx === node.children!.length - 1 && <div className="h-px w-1/2 bg-transparent" />}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Child Nodes */}
                        <div className="flex gap-6 flex-wrap justify-center pt-2">
                            {node.children?.map((child) => (
                                <div key={child.id} className="flex flex-col items-center">
                                    {/* Vertical connector from horizontal line */}
                                    <div className="w-px h-4 bg-gray-300" />
                                    <DepartmentNode
                                        node={child}
                                        isEditMode={isEditMode}
                                        highlightedId={highlightedId}
                                        onNodeClick={onNodeClick}
                                        onEditClick={onEditClick}
                                        level={level + 1}
                                    />
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

// ============================================================================
// User Node Component
// ============================================================================

interface UserNodeProps {
    node: UserOrgChartNode
    isEditMode: boolean
    onNodeClick?: (node: UserOrgChartNode) => void
    onEditClick?: (node: UserOrgChartNode) => void
    level: number
    styleVariant?: 'modern' | 'classic'
}

function UserNode({ node, isEditMode, onNodeClick, onEditClick, level, styleVariant = 'modern' }: UserNodeProps) {
    const [isExpanded, setIsExpanded] = useState(level < 3)
    const hasChildren = node.children && node.children.length > 0
    const isClassic = styleVariant === 'classic'
    const displayRole = node.position_name || node.role_name || node.role_code || 'Employee'

    const getRoleBadgeColor = (roleLevel: number | null) => {
        if (roleLevel === null) return 'bg-gray-100 text-gray-600'
        if (roleLevel <= 10) return 'bg-purple-100 text-purple-700'
        if (roleLevel <= 20) return 'bg-blue-100 text-blue-700'
        if (roleLevel <= 30) return 'bg-green-100 text-green-700'
        return 'bg-gray-100 text-gray-600'
    }

    return (
        <div className="flex flex-col items-center">
            {/* Node Card */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: level * 0.05 }}
                className={
                    `
          relative min-w-[180px] max-w-[220px]
          ${isClassic ? 'bg-transparent border-0 shadow-none' : 'bg-white border-2 rounded-lg shadow-sm'}
          transition-all duration-200 cursor-pointer
          ${!node.is_active ? 'opacity-60 border-gray-200' : isClassic ? '' : 'border-gray-200 hover:border-green-300 hover:shadow-md'}
        `
                }
                onClick={() => onNodeClick?.(node)}
            >
                {/* User Avatar and Name */}
                {isClassic ? (
                    <div className="flex flex-col items-center">
                        <div className="h-16 w-16 rounded-full border-4 border-white shadow-md overflow-hidden bg-gray-100">
                            <Avatar className="h-16 w-16">
                                <AvatarImage src={node.avatar_url || undefined} alt={node.full_name || 'User'} />
                                <AvatarFallback className="text-base">
                                    {node.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2) || '?'}
                                </AvatarFallback>
                            </Avatar>
                        </div>
                        <div className="mt-2 bg-[#E9DED3] text-gray-900 rounded-md px-4 py-2 text-center min-w-[160px] shadow-sm">
                            <div className="font-semibold text-sm truncate">{node.full_name || 'Unknown'}</div>
                            <div className="text-[11px] uppercase tracking-wide text-gray-600 truncate">{displayRole}</div>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* User Avatar and Name */}
                        <div className="p-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <Avatar className="h-6 w-6">
                                    <AvatarImage src={node.avatar_url || undefined} alt={node.full_name || 'User'} />
                                    <AvatarFallback>
                                        {node.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2) || '?'}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm text-gray-900 truncate">
                                        {node.full_name || 'Unknown'}
                                    </p>
                                    {node.position_name && (
                                        <p className="text-xs text-gray-600 truncate">{node.position_name}</p>
                                    )}
                                    <p className="text-xs text-gray-500 truncate">{node.email}</p>
                                </div>
                            </div>

                            {/* Role */}
                            <Badge className={`text-xs ${getRoleBadgeColor(node.role_level)}`}>
                                {node.role_name || node.role_code}
                            </Badge>

                            {/* Department */}
                            {node.department_name && (
                                <div className="flex items-center gap-1 text-xs text-gray-500">
                                    <Building2 className="h-3 w-3" />
                                    <span className="truncate">{node.department_code ? `${node.department_code} • ` : ''}{node.department_name}</span>
                                </div>
                            )}
                        </div>
                    </>
                )}
                {/* Edit Button (Edit Mode) */}
                {isEditMode && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            onEditClick?.(node)
                        }}
                        className="absolute -top-2 -right-2 p-1.5 bg-green-500 text-white rounded-full shadow hover:bg-green-600 transition-colors"
                    >
                        <Edit className="h-3 w-3" />
                    </button>
                )}
            </motion.div>

            {/* Connector Line to Children */}
            {hasChildren && (
                <>
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="mt-1 p-1 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                        {isExpanded ? (
                            <ChevronDown className="h-3 w-3 text-gray-500" />
                        ) : (
                            <ChevronRight className="h-3 w-3 text-gray-500" />
                        )}
                    </button>

                    <AnimatePresence>
                        {isExpanded && (
                            <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 16, opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="w-px bg-gray-300"
                            />
                        )}
                    </AnimatePresence>
                </>
            )}

            {/* Children */}
            <AnimatePresence>
                {hasChildren && isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex gap-4 flex-wrap justify-center pt-2"
                    >
                        {node.children?.map((child) => (
                            <div key={child.id} className="flex flex-col items-center">
                                <div className="w-px h-3 bg-gray-300" />
                                <UserNode
                                    node={child}
                                    isEditMode={isEditMode}
                                    onNodeClick={onNodeClick}
                                    onEditClick={onEditClick}
                                    level={level + 1}
                                />
                            </div>
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

// ============================================================================
// Main Component
// ============================================================================

export default function OrgChartTab({ organizationId, canEdit, onNavigateToDepartment }: OrgChartTabProps) {
    const [viewMode, setViewMode] = useState<'departments' | 'people'>('departments')
    const [isEditMode, setIsEditMode] = useState(false)
    const [showDisabled, setShowDisabled] = useState(false)
    const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState<string>('all')
    const [useDeptManagerFallback, setUseDeptManagerFallback] = useState(false)
    const [groupByDepartment, setGroupByDepartment] = useState(false)
    const [peopleSearch, setPeopleSearch] = useState('')
    const [zoom, setZoom] = useState(100)
    const [chartStyle, setChartStyle] = useState<'modern' | 'classic'>('modern')

    // Data states
    const [deptHierarchy, setDeptHierarchy] = useState<DepartmentHierarchyNode[]>([])
    const [userHierarchy, setUserHierarchy] = useState<UserOrgChartNode[]>([])
    const [departments, setDepartments] = useState<Department[]>([])
    const [orgUsers, setOrgUsers] = useState<{
        id: string
        full_name: string | null
        email: string
        avatar_url?: string | null
        position_name?: string | null
    }[]>([])
    const [positions, setPositions] = useState<{ id: string; name: string; is_active: boolean }[]>([])
    const [loading, setLoading] = useState(true)

    // Edit drawers state
    const [departmentEditOpen, setDepartmentEditOpen] = useState(false)
    const [departmentEditNode, setDepartmentEditNode] = useState<DepartmentHierarchyNode | null>(null)
    const [departmentForm, setDepartmentForm] = useState({
        parent_department_id: 'none',
        chart_order: '',
        manager_user_id: 'none'
    })
    const [departmentSaving, setDepartmentSaving] = useState(false)

    const [userEditOpen, setUserEditOpen] = useState(false)
    const [userEditNode, setUserEditNode] = useState<UserOrgChartNode | null>(null)
    const [userForm, setUserForm] = useState({
        manager_user_id: 'none',
        department_id: 'none',
        position_id: 'none',
        employment_type: 'none',
        join_date: '',
        employment_status: 'active'
    })
    const [userSaving, setUserSaving] = useState(false)

    const [userDetailOpen, setUserDetailOpen] = useState(false)
    const [userDetailNode, setUserDetailNode] = useState<UserOrgChartNode | null>(null)

    const [membersDrawerOpen, setMembersDrawerOpen] = useState(false)
    const [membersDrawerLoading, setMembersDrawerLoading] = useState(false)
    const [membersDrawerDept, setMembersDrawerDept] = useState<DepartmentHierarchyNode | null>(null)
    const [membersDrawerMembers, setMembersDrawerMembers] = useState<DepartmentMember[]>([])
    const [membersDrawerQuery, setMembersDrawerQuery] = useState('')
    const [highlightedDepartmentId, setHighlightedDepartmentId] = useState<string | null>(null)

    const { toast } = useToast()

    // Load data
    const loadDepartmentHierarchy = useCallback(async () => {
        const result = await getDepartmentHierarchy(organizationId, showDisabled)
        if (result.success && result.data) {
            setDeptHierarchy(result.data)
        }
    }, [organizationId, showDisabled])

    const loadUserHierarchy = useCallback(async () => {
        const deptId = selectedDepartmentFilter === 'all' ? null : selectedDepartmentFilter
        const result = await getUserOrgChart(organizationId, deptId, showDisabled, useDeptManagerFallback)
        if (result.success && result.data) {
            setUserHierarchy(result.data)
        }
    }, [organizationId, selectedDepartmentFilter, showDisabled, useDeptManagerFallback])

    const loadDepartments = useCallback(async () => {
        const result = await listDepartments(organizationId, true)
        if (result.success && result.data) {
            setDepartments(result.data)
        }
    }, [organizationId])

    const loadOrgUsers = useCallback(async () => {
        const result = await getUsersForOrgPicker(organizationId)
        if (result.success && result.data) {
            setOrgUsers(result.data)
        }
    }, [organizationId])

    const loadPositions = useCallback(async () => {
        const result = await fetchHrPositions(true)
        if (result.success && result.data) {
            setPositions(result.data.map(p => ({ id: p.id, name: p.name, is_active: p.is_active })))
        }
    }, [organizationId])

    useEffect(() => {
        const loadAll = async () => {
            setLoading(true)
            await Promise.all([loadDepartmentHierarchy(), loadUserHierarchy(), loadDepartments(), loadOrgUsers(), loadPositions()])
            setLoading(false)
        }
        loadAll()
    }, [loadDepartmentHierarchy, loadUserHierarchy, loadDepartments, loadOrgUsers, loadPositions])

    // Refresh on filter/view changes
    useEffect(() => {
        if (viewMode === 'departments') {
            loadDepartmentHierarchy()
        } else {
            loadUserHierarchy()
        }
    }, [viewMode, showDisabled, selectedDepartmentFilter, useDeptManagerFallback, loadDepartmentHierarchy, loadUserHierarchy])

    const departmentMap = useMemo(() => {
        const map = new Map<string, Department>()
        departments.forEach(dept => map.set(dept.id, dept))
        return map
    }, [departments])

    const departmentChildrenMap = useMemo(() => {
        const map = new Map<string, string[]>()
        departments.forEach(dept => {
            if (dept.parent_department_id) {
                const current = map.get(dept.parent_department_id) || []
                current.push(dept.id)
                map.set(dept.parent_department_id, current)
            }
        })
        return map
    }, [departments])

    const getDescendantIds = useCallback((deptId: string) => {
        const visited = new Set<string>()
        const stack = [deptId]
        while (stack.length > 0) {
            const current = stack.pop()!
            const children = departmentChildrenMap.get(current) || []
            for (const child of children) {
                if (!visited.has(child)) {
                    visited.add(child)
                    stack.push(child)
                }
            }
        }
        return visited
    }, [departmentChildrenMap])

    const computeDepartmentLevel = useCallback((parentId: string | null) => {
        if (!parentId) return 1
        let level = 1
        let current: string | null = parentId
        const visited = new Set<string>()
        while (current) {
            if (visited.has(current)) break
            visited.add(current)
            level += 1
            current = departmentMap.get(current)?.parent_department_id || null
        }
        return level
    }, [departmentMap])

    const flattenUserTree = useCallback((nodes: UserOrgChartNode[]): UserOrgChartNode[] => {
        const list: UserOrgChartNode[] = []
        const walk = (n: UserOrgChartNode[]) => {
            n.forEach(node => {
                list.push(node)
                if (node.children && node.children.length > 0) walk(node.children)
            })
        }
        walk(nodes)
        return list
    }, [])

    const filterUserTreeByDepartment = useCallback(
        (nodes: UserOrgChartNode[], deptId: string | null) => {
            const filterNodes = (items: UserOrgChartNode[]): UserOrgChartNode[] => {
                return items
                    .map(node => ({
                        ...node,
                        children: node.children ? filterNodes(node.children) : []
                    }))
                    .filter(node => {
                        const matchesDept = deptId === null ? !node.department_id : node.department_id === deptId
                        return matchesDept || (node.children && node.children.length > 0)
                    })
            }
            return filterNodes(nodes)
        },
        []
    )

    const filterUserTreeBySearch = useCallback(
        (nodes: UserOrgChartNode[], query: string) => {
            const q = query.trim().toLowerCase()
            if (!q) return nodes

            const filterNodes = (items: UserOrgChartNode[]): UserOrgChartNode[] => {
                return items
                    .map(node => ({
                        ...node,
                        children: node.children ? filterNodes(node.children) : []
                    }))
                    .filter(node => {
                        const matches =
                            (node.full_name || '').toLowerCase().includes(q) ||
                            node.email.toLowerCase().includes(q) ||
                            (node.position_name || '').toLowerCase().includes(q)
                        return matches || (node.children && node.children.length > 0)
                    })
            }

            return filterNodes(nodes)
        },
        []
    )

    const handleDepartmentClick = (node: DepartmentHierarchyNode) => {
        setMembersDrawerDept(node)
        setMembersDrawerOpen(true)
        setMembersDrawerQuery('')
        setHighlightedDepartmentId(node.id)
        setViewMode('people')
        setSelectedDepartmentFilter(node.id)
        setGroupByDepartment(false)
        setPeopleSearch('')
        setMembersDrawerLoading(true)

        getDepartmentMembers(node.id)
            .then(result => {
                if (result.success && result.data) {
                    setMembersDrawerMembers(result.data)
                } else {
                    toast({
                        title: 'Error',
                        description: result.error || 'Failed to load members',
                        variant: 'destructive'
                    })
                }
            })
            .finally(() => setMembersDrawerLoading(false))
    }

    const handleUserClick = (node: UserOrgChartNode) => {
        if (isEditMode) return
        setUserDetailNode(node)
        setUserDetailOpen(true)
    }

    const handleDepartmentEditClick = (node: DepartmentHierarchyNode) => {
        if (!canEdit) return
        setDepartmentEditNode(node)
        setDepartmentForm({
            parent_department_id: node.parent_department_id || 'none',
            chart_order: node.chart_order !== null && node.chart_order !== undefined ? String(node.chart_order) : '',
            manager_user_id: node.manager_user_id || 'none'
        })
        setDepartmentEditOpen(true)
    }

    const handleUserEditClick = (node: UserOrgChartNode) => {
        if (!canEdit) return
        setUserEditNode(node)
        setUserForm({
            manager_user_id: node.manager_user_id || 'none',
            department_id: node.department_id || 'none',
            position_id: node.position_id || 'none',
            employment_type: node.employment_type || 'none',
            join_date: node.join_date || '',
            employment_status: node.employment_status || 'active'
        })
        setUserEditOpen(true)
    }

    const handleSaveDepartmentEdit = async () => {
        if (!departmentEditNode) return
        setDepartmentSaving(true)

        const result = await updateDepartmentChart(departmentEditNode.id, {
            parent_department_id: departmentForm.parent_department_id === 'none' ? null : departmentForm.parent_department_id,
            chart_order: departmentForm.chart_order ? parseInt(departmentForm.chart_order, 10) : null,
            manager_user_id: departmentForm.manager_user_id === 'none' ? null : departmentForm.manager_user_id
        })

        setDepartmentSaving(false)

        if (result.success) {
            toast({ title: 'Updated', description: 'Department chart updated.' })
            setDepartmentEditOpen(false)
            await Promise.all([loadDepartmentHierarchy(), loadDepartments()])
        } else {
            toast({ title: 'Error', description: result.error || 'Failed to update department', variant: 'destructive' })
        }
    }

    const handleSaveUserEdit = async () => {
        if (!userEditNode) return
        setUserSaving(true)

        const result = await updateUserHr(userEditNode.id, {
            manager_user_id: userForm.manager_user_id === 'none' ? null : userForm.manager_user_id,
            department_id: userForm.department_id === 'none' ? null : userForm.department_id,
            position_id: userForm.position_id === 'none' ? null : userForm.position_id,
            employment_type: userForm.employment_type === 'none' ? null : userForm.employment_type,
            join_date: userForm.join_date ? userForm.join_date : null,
            employment_status: userForm.employment_status || 'active'
        })

        setUserSaving(false)

        if (result.success) {
            toast({ title: 'Updated', description: 'Reporting line updated.' })
            setUserEditOpen(false)
            await loadUserHierarchy()
        } else {
            toast({ title: 'Error', description: result.error || 'Failed to update reporting line', variant: 'destructive' })
        }
    }

    const handleMoveDepartment = async (direction: 'up' | 'down') => {
        if (!departmentEditNode) return
        const result = await reorderDepartmentWithinParent(departmentEditNode.id, direction)
        if (result.success) {
            toast({ title: 'Updated', description: 'Department order updated.' })
            await loadDepartmentHierarchy()
        } else {
            toast({ title: 'Error', description: result.error || 'Failed to reorder department', variant: 'destructive' })
        }
    }

    const handleSetRoot = () => {
        setDepartmentForm(prev => ({ ...prev, parent_department_id: 'none' }))
    }

    const handleWizardMakeManagementRoot = async () => {
        const managementDept = departments.find(dept => dept.dept_name.toLowerCase() === 'management')
        if (!managementDept) {
            toast({ title: 'Not found', description: 'Management department not found.', variant: 'destructive' })
            return
        }

        const result = await updateDepartmentChart(managementDept.id, { parent_department_id: null })
        if (result.success) {
            toast({ title: 'Updated', description: 'Management set as root.' })
            await loadDepartmentHierarchy()
        } else {
            toast({ title: 'Error', description: result.error || 'Failed to set root', variant: 'destructive' })
        }
    }

    const handleWizardPlaceUnderManagement = async () => {
        const managementDept = departments.find(dept => dept.dept_name.toLowerCase() === 'management')
        if (!managementDept) {
            toast({ title: 'Not found', description: 'Management department not found.', variant: 'destructive' })
            return
        }

        const ordered = [...departments]
            .filter(d => d.id !== managementDept.id)
            .sort((a, b) => {
                const aOrder = a.sort_order ?? Number.POSITIVE_INFINITY
                const bOrder = b.sort_order ?? Number.POSITIVE_INFINITY
                if (aOrder !== bOrder) return aOrder - bOrder
                return a.dept_name.localeCompare(b.dept_name)
            })

        const results = await Promise.all(
            ordered.map((dept, index) =>
                updateDepartmentChart(dept.id, {
                    parent_department_id: managementDept.id,
                    chart_order: index + 1
                })
            )
        )

        const failed = results.find(r => !r.success)
        if (failed) {
            toast({ title: 'Error', description: failed.error || 'Failed to update hierarchy', variant: 'destructive' })
        } else {
            toast({ title: 'Updated', description: 'Departments placed under Management.' })
            await loadDepartmentHierarchy()
        }
    }

    const handleApplyDeptManagerDefaults = async () => {
        if (!canEdit || selectedDepartmentFilter !== 'all') return
        const nodes = flattenUserTree(userHierarchy)
        const updates = nodes
            .filter(node => !node.manager_user_id && node.department_id)
            .map(node => {
                const deptManagerId = departmentMap.get(node.department_id || '')?.manager_user_id
                if (!deptManagerId || deptManagerId === node.id) return null
                return { userId: node.id, managerId: deptManagerId }
            })
            .filter(Boolean) as { userId: string; managerId: string }[]

        if (updates.length === 0) {
            toast({ title: 'No changes', description: 'No users to update.' })
            return
        }

        const results = await Promise.all(
            updates.map(update => updateUserHr(update.userId, { manager_user_id: update.managerId }))
        )

        const failed = results.find(r => !r.success)
        if (failed) {
            toast({ title: 'Error', description: failed.error || 'Failed to apply defaults', variant: 'destructive' })
        } else {
            toast({ title: 'Updated', description: 'Default reporting lines applied.' })
            await loadUserHierarchy()
        }
    }

    const handleRefresh = async () => {
        setLoading(true)
        await Promise.all([loadDepartmentHierarchy(), loadUserHierarchy()])
        setLoading(false)
        toast({
            title: 'Refreshed',
            description: 'Organization chart updated'
        })
    }

    // Count stats
    const totalDepts = useMemo(() => {
        const count = (nodes: DepartmentHierarchyNode[]): number =>
            nodes.reduce((acc, n) => acc + 1 + count(n.children || []), 0)
        return count(deptHierarchy)
    }, [deptHierarchy])

    const totalUsers = useMemo(() => {
        const count = (nodes: UserOrgChartNode[]): number =>
            nodes.reduce((acc, n) => acc + 1 + count(n.children || []), 0)
        return count(userHierarchy)
    }, [userHierarchy])

    const searchableUserHierarchy = useMemo(
        () => filterUserTreeBySearch(userHierarchy, peopleSearch),
        [userHierarchy, peopleSearch, filterUserTreeBySearch]
    )

    const filteredDrawerMembers = useMemo(() => {
        if (!membersDrawerQuery) return membersDrawerMembers
        const query = membersDrawerQuery.toLowerCase()
        return membersDrawerMembers.filter(member =>
            (member.full_name || '').toLowerCase().includes(query) ||
            member.email.toLowerCase().includes(query)
        )
    }, [membersDrawerMembers, membersDrawerQuery])

    const visibleDepartments = useMemo(() => {
        const list = departments.filter(d => showDisabled || d.is_active)
        if (selectedDepartmentFilter !== 'all') {
            return list.filter(d => d.id === selectedDepartmentFilter)
        }
        return list
    }, [departments, showDisabled, selectedDepartmentFilter])

    const groupedUserTrees = useMemo(() => {
        if (!groupByDepartment) return [] as { dept: Department | null; nodes: UserOrgChartNode[] }[]

        const groups: { dept: Department | null; nodes: UserOrgChartNode[] }[] = visibleDepartments.map(dept => ({
            dept,
            nodes: filterUserTreeByDepartment(searchableUserHierarchy, dept.id)
        }))

        if (selectedDepartmentFilter === 'all') {
            groups.push({
                dept: null,
                nodes: filterUserTreeByDepartment(searchableUserHierarchy, null)
            })
        }

        return groups
    }, [groupByDepartment, visibleDepartments, searchableUserHierarchy, filterUserTreeByDepartment, selectedDepartmentFilter])

    const blockedParentIds = useMemo(() => {
        if (!departmentEditNode) return new Set<string>()
        const descendants = getDescendantIds(departmentEditNode.id)
        descendants.add(departmentEditNode.id)
        return descendants
    }, [departmentEditNode, getDescendantIds])

    const chartLevelPreview = useMemo(() => {
        const parentId = departmentForm.parent_department_id === 'none' ? null : departmentForm.parent_department_id
        return computeDepartmentLevel(parentId)
    }, [departmentForm.parent_department_id, computeDepartmentLevel])

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <Network className="h-5 w-5 text-blue-600" />
                            Organization Chart
                        </CardTitle>
                        <CardDescription>
                            Visualize your organization structure and reporting lines
                        </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Controls */}
                <div className="flex flex-wrap items-center gap-4 p-4 bg-gray-50 rounded-lg">
                    {/* View Mode Tabs */}
                    <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'departments' | 'people')}>
                        <TabsList>
                            <TabsTrigger value="departments" className="flex items-center gap-2">
                                <Building2 className="h-4 w-4" />
                                Departments
                            </TabsTrigger>
                            <TabsTrigger value="people" className="flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                People
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>

                    {/* People controls */}
                    <div className="flex flex-wrap items-center gap-3">
                        {viewMode === 'people' && (
                            <>
                                <div className="relative">
                                    <Input
                                        value={peopleSearch}
                                        onChange={(e) => setPeopleSearch(e.target.value)}
                                        placeholder="Search people..."
                                        className="w-[220px]"
                                    />
                                </div>
                                <Select value={selectedDepartmentFilter} onValueChange={setSelectedDepartmentFilter}>
                                    <SelectTrigger className="w-[200px]">
                                        <SelectValue placeholder="Filter by department" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Departments</SelectItem>
                                        {departments.filter(d => d.is_active).map(dept => (
                                            <SelectItem key={dept.id} value={dept.id}>
                                                {dept.dept_code ? `${dept.dept_code} - ` : ''}{dept.dept_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </>
                        )}

                        <Select
                            value={chartStyle}
                            onValueChange={(value) => setChartStyle(value as 'modern' | 'classic')}
                            disabled={viewMode !== 'people'}
                        >
                            <SelectTrigger className="w-[200px]">
                                <SelectValue placeholder="People chart style" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="modern">Modern cards</SelectItem>
                                <SelectItem value="classic">Classic org chart</SelectItem>
                            </SelectContent>
                        </Select>

                        {viewMode === 'people' && (
                            <>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        id="use-dept-manager"
                                        checked={useDeptManagerFallback}
                                        onCheckedChange={setUseDeptManagerFallback}
                                    />
                                    <Label htmlFor="use-dept-manager" className="text-sm text-gray-600">
                                        Use Department Manager as default
                                    </Label>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Switch
                                        id="group-by-department"
                                        checked={groupByDepartment}
                                        onCheckedChange={setGroupByDepartment}
                                    />
                                    <Label htmlFor="group-by-department" className="text-sm text-gray-600">
                                        Group by Department
                                    </Label>
                                </div>

                                {useDeptManagerFallback && isEditMode && canEdit && selectedDepartmentFilter === 'all' && (
                                    <Button variant="outline" size="sm" onClick={handleApplyDeptManagerDefaults}>
                                        Apply Defaults
                                    </Button>
                                )}
                            </>
                        )}
                    </div>

                    {/* Show Disabled Toggle */}
                    <div className="flex items-center gap-2">
                        <Switch
                            id="show-disabled-chart"
                            checked={showDisabled}
                            onCheckedChange={setShowDisabled}
                        />
                        <Label htmlFor="show-disabled-chart" className="text-sm text-gray-600">
                            Show disabled
                        </Label>
                    </div>

                    {/* Edit Mode Toggle (Admin only) */}
                    {canEdit && (
                        <div className="flex items-center gap-2 ml-auto">
                            <Switch
                                id="edit-mode"
                                checked={isEditMode}
                                onCheckedChange={setIsEditMode}
                            />
                            <Label htmlFor="edit-mode" className="text-sm text-gray-600">
                                Edit Mode
                            </Label>
                        </div>
                    )}

                    {/* Zoom Controls */}
                    <div className="flex items-center gap-1 border rounded-lg bg-white">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setZoom(Math.max(50, zoom - 10))}
                            disabled={zoom <= 50}
                        >
                            <ZoomOut className="h-4 w-4" />
                        </Button>
                        <span className="text-sm text-gray-600 w-12 text-center">{zoom}%</span>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setZoom(Math.min(150, zoom + 10))}
                            disabled={zoom >= 150}
                        >
                            <ZoomIn className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setZoom(100)}
                        >
                            <Maximize2 className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Stats Bar */}
                <div className="flex gap-4 text-sm text-gray-600">
                    {viewMode === 'departments' ? (
                        <span>{totalDepts} department{totalDepts !== 1 ? 's' : ''}</span>
                    ) : (
                        <span>{totalUsers} user{totalUsers !== 1 ? 's' : ''} in chart</span>
                    )}
                    {isEditMode && (
                        <Badge variant="outline" className="text-blue-600 border-blue-300">
                            Edit Mode Active
                        </Badge>
                    )}
                </div>

                {viewMode === 'departments' && departments.length > 0 && departments.every(d => !d.parent_department_id) && (
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 border border-amber-200 bg-amber-50 rounded-lg">
                        <div>
                            <p className="font-medium text-amber-900">Your org chart is not structured yet.</p>
                            <p className="text-sm text-amber-700">Use the quick wizard to set Management as the root and place others under it.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={handleWizardMakeManagementRoot}>
                                Make Management the root
                            </Button>
                            <Button size="sm" onClick={handleWizardPlaceUnderManagement}>
                                Place all other departments under Management
                            </Button>
                        </div>
                    </div>
                )}

                {/* Chart Container */}
                <div
                    className="relative overflow-auto border rounded-lg bg-gradient-to-b from-gray-50 to-white min-h-[400px] p-8"
                    style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
                >
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                        </div>
                    ) : viewMode === 'departments' ? (
                        deptHierarchy.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                                <Building2 className="h-12 w-12 mb-4 text-gray-300" />
                                <p className="text-lg font-medium">No departments found</p>
                                <p className="text-sm">Create departments to see the organization structure</p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-6">
                                {/* Render root departments */}
                                <div className="flex gap-8 flex-wrap justify-center">
                                    {deptHierarchy.map((rootNode) => (
                                        <DepartmentNode
                                            key={rootNode.id}
                                            node={rootNode}
                                            isEditMode={isEditMode}
                                            highlightedId={highlightedDepartmentId}
                                            onNodeClick={handleDepartmentClick}
                                            onEditClick={handleDepartmentEditClick}
                                            level={0}
                                        />
                                    ))}
                                </div>
                            </div>
                        )
                    ) : (
                        searchableUserHierarchy.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                                <Users className="h-12 w-12 mb-4 text-gray-300" />
                                <p className="text-lg font-medium">No reporting structure found</p>
                                <p className="text-sm">Set up manager relationships or clear filters to see the org chart</p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-6">
                                {groupByDepartment ? (
                                    <div className="w-full space-y-6">
                                        {groupedUserTrees.map(group => (
                                            <div key={group.dept?.id || 'unassigned'} className="space-y-3">
                                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                                    <Building2 className="h-4 w-4" />
                                                    <span className="font-medium">
                                                        {group.dept
                                                            ? `${group.dept.dept_code ? `${group.dept.dept_code} - ` : ''}${group.dept.dept_name}`
                                                            : 'Unassigned'}
                                                    </span>
                                                </div>
                                                <div className="flex gap-6 flex-wrap justify-center">
                                                    {group.nodes.map(rootNode => (
                                                        <UserNode
                                                            key={rootNode.id}
                                                            node={rootNode}
                                                            isEditMode={isEditMode}
                                                            styleVariant={chartStyle}
                                                            onNodeClick={handleUserClick}
                                                            onEditClick={handleUserEditClick}
                                                            level={0}
                                                        />
                                                    ))}
                                                    {group.nodes.length === 0 && (
                                                        <div className="text-sm text-gray-400">No users</div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="flex gap-6 flex-wrap justify-center">
                                        {searchableUserHierarchy.map((rootNode) => (
                                            <UserNode
                                                key={rootNode.id}
                                                node={rootNode}
                                                isEditMode={isEditMode}
                                                styleVariant={chartStyle}
                                                onNodeClick={handleUserClick}
                                                onEditClick={handleUserEditClick}
                                                level={0}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        )
                    )}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-4 text-xs text-gray-500 pt-2">
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded bg-gradient-to-r from-blue-500 to-blue-600" />
                        <span>Department</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded bg-gradient-to-br from-green-400 to-emerald-500" />
                        <span>User</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded bg-gray-200" />
                        <span>Disabled</span>
                    </div>
                    {isEditMode && (
                        <div className="flex items-center gap-2 text-blue-600">
                            <Edit className="h-3 w-3" />
                            <span>Click to edit</span>
                        </div>
                    )}
                </div>

                {/* Department Edit Dialog */}
                <Dialog open={departmentEditOpen} onOpenChange={setDepartmentEditOpen}>
                    <DialogContent className="sm:max-w-[520px]">
                        <DialogHeader>
                            <DialogTitle>Edit Department in Org Chart</DialogTitle>
                            <DialogDescription>
                                Update reporting structure and ordering for this department.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>Parent Department</Label>
                                <Select
                                    value={departmentForm.parent_department_id}
                                    onValueChange={(value) => setDepartmentForm(prev => ({ ...prev, parent_department_id: value }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select parent" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None (Root)</SelectItem>
                                        {departments
                                            .filter(d => !blockedParentIds.has(d.id))
                                            .map(dept => (
                                                <SelectItem key={dept.id} value={dept.id}>
                                                    {dept.dept_code ? `${dept.dept_code} - ` : ''}{dept.dept_name}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                                <Button variant="link" size="sm" className="px-0" onClick={handleSetRoot}>
                                    Set as Root
                                </Button>
                            </div>

                            <div className="space-y-2">
                                <Label>Chart Level Preview</Label>
                                <Input value={`Level ${chartLevelPreview}`} readOnly />
                            </div>

                            <div className="space-y-2">
                                <Label>Chart Order (optional)</Label>
                                <Input
                                    type="number"
                                    value={departmentForm.chart_order}
                                    onChange={(e) => setDepartmentForm(prev => ({ ...prev, chart_order: e.target.value }))}
                                    placeholder="1, 2, 3..."
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Department Manager</Label>
                                <Select
                                    value={departmentForm.manager_user_id}
                                    onValueChange={(value) => setDepartmentForm(prev => ({ ...prev, manager_user_id: value }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select manager" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">No manager</SelectItem>
                                        {orgUsers.map(user => (
                                            <SelectItem key={user.id} value={user.id}>
                                                {user.full_name || user.email}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" onClick={() => handleMoveDepartment('up')}>
                                    Move Up
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleMoveDepartment('down')}>
                                    Move Down
                                </Button>
                            </div>
                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={() => setDepartmentEditOpen(false)} disabled={departmentSaving}>
                                Cancel
                            </Button>
                            <Button onClick={handleSaveDepartmentEdit} disabled={departmentSaving}>
                                {departmentSaving ? 'Saving...' : 'Save'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* User Edit Dialog */}
                <Dialog open={userEditOpen} onOpenChange={setUserEditOpen}>
                    <DialogContent className="sm:max-w-[520px]">
                        <DialogHeader>
                            <DialogTitle>Edit Reporting Line</DialogTitle>
                            <DialogDescription>Update who this person reports to.</DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>Reports To</Label>
                                <Select
                                    value={userForm.manager_user_id}
                                    onValueChange={(value) => setUserForm(prev => ({ ...prev, manager_user_id: value }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select manager" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">No manager (Root)</SelectItem>
                                        {orgUsers
                                            .filter(u => u.id !== userEditNode?.id)
                                            .map(user => (
                                                <SelectItem key={user.id} value={user.id}>
                                                    {user.full_name || user.email}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                                {userForm.manager_user_id !== 'none' && (
                                    <Button
                                        variant="link"
                                        size="sm"
                                        className="px-0"
                                        onClick={() => setUserForm(prev => ({ ...prev, manager_user_id: 'none' }))}
                                    >
                                        Set as Top Leader
                                    </Button>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label>Department (optional)</Label>
                                <Select
                                    value={userForm.department_id}
                                    onValueChange={(value) => setUserForm(prev => ({ ...prev, department_id: value }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select department" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">No department</SelectItem>
                                        {departments.map(dept => (
                                            <SelectItem key={dept.id} value={dept.id}>
                                                {dept.dept_code ? `${dept.dept_code} - ` : ''}{dept.dept_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Position (optional)</Label>
                                <Select
                                    value={userForm.position_id}
                                    onValueChange={(value) => setUserForm(prev => ({ ...prev, position_id: value }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select position" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">No position</SelectItem>
                                        {positions
                                            .filter(p => p.is_active)
                                            .map(position => (
                                                <SelectItem key={position.id} value={position.id}>
                                                    {position.name}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Employment Type</Label>
                                <Select
                                    value={userForm.employment_type}
                                    onValueChange={(value) => setUserForm(prev => ({ ...prev, employment_type: value }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select employment type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Not set</SelectItem>
                                        <SelectItem value="Full-time">Full-time</SelectItem>
                                        <SelectItem value="Part-time">Part-time</SelectItem>
                                        <SelectItem value="Contract">Contract</SelectItem>
                                        <SelectItem value="Intern">Intern</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Join Date</Label>
                                <Input
                                    type="date"
                                    value={userForm.join_date}
                                    onChange={(e) => setUserForm(prev => ({ ...prev, join_date: e.target.value }))}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Employment Status</Label>
                                <Select
                                    value={userForm.employment_status}
                                    onValueChange={(value) => setUserForm(prev => ({ ...prev, employment_status: value }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="resigned">Resigned</SelectItem>
                                        <SelectItem value="terminated">Terminated</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={() => setUserEditOpen(false)} disabled={userSaving}>
                                Cancel
                            </Button>
                            <Button onClick={handleSaveUserEdit} disabled={userSaving}>
                                {userSaving ? 'Saving...' : 'Save'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* User Detail Dialog */}
                <Dialog open={userDetailOpen} onOpenChange={setUserDetailOpen}>
                    <DialogContent className="sm:max-w-[520px]">
                        <DialogHeader>
                            <DialogTitle>User Details</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-2 text-sm text-gray-700">
                            <div><span className="font-medium">Name:</span> {userDetailNode?.full_name || 'Unknown'}</div>
                            <div><span className="font-medium">Email:</span> {userDetailNode?.email || '-'}</div>
                            <div><span className="font-medium">Role:</span> {userDetailNode?.role_name || userDetailNode?.role_code || '-'}</div>
                            <div><span className="font-medium">Position:</span> {userDetailNode?.position_name || 'No position'}</div>
                            <div><span className="font-medium">Department:</span> {userDetailNode?.department_name || 'No department'}</div>
                            <div><span className="font-medium">Manager:</span> {userDetailNode?.manager_name || 'No manager'}</div>
                            <div><span className="font-medium">Employment Type:</span> {userDetailNode?.employment_type || 'Not set'}</div>
                            <div><span className="font-medium">Join Date:</span> {userDetailNode?.join_date || 'Not set'}</div>
                            <div><span className="font-medium">Employment Status:</span> {userDetailNode?.employment_status || 'active'}</div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setUserDetailOpen(false)}>
                                Close
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Sheet
                    open={membersDrawerOpen}
                    onOpenChange={(open) => {
                        setMembersDrawerOpen(open)
                        if (!open) {
                            setHighlightedDepartmentId(null)
                            setMembersDrawerDept(null)
                            setMembersDrawerMembers([])
                        }
                    }}
                >
                    <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
                        <SheetHeader>
                            <SheetTitle>
                                {membersDrawerDept?.dept_name || 'Department Members'}
                            </SheetTitle>
                            <div className="text-sm text-gray-500">
                                {membersDrawerDept?.user_count ?? 0} member(s)
                            </div>
                        </SheetHeader>

                        <div className="mt-4 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <Input
                                    value={membersDrawerQuery}
                                    onChange={(e) => setMembersDrawerQuery(e.target.value)}
                                    placeholder="Search members..."
                                />
                                {onNavigateToDepartment && membersDrawerDept && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => onNavigateToDepartment(membersDrawerDept.id)}
                                    >
                                        Open in Departments
                                    </Button>
                                )}
                            </div>

                            {membersDrawerLoading ? (
                                <div className="py-8 text-center text-gray-500">Loading members...</div>
                            ) : filteredDrawerMembers.length === 0 ? (
                                <div className="py-8 text-center text-gray-500">No members found.</div>
                            ) : (
                                <div className="space-y-3">
                                    {filteredDrawerMembers.map(member => (
                                        <div
                                            key={member.id}
                                            className="flex items-center justify-between gap-3 rounded-lg border p-3"
                                        >
                                            <div className="min-w-0">
                                                <div className="font-medium truncate">
                                                    {member.full_name || 'Unknown'}
                                                </div>
                                                <div className="text-xs text-gray-500 truncate">{member.email}</div>
                                                <div className="text-xs text-gray-500">
                                                    Reports to {member.manager?.full_name || 'No manager'}
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-1">
                                                <Badge variant="outline" className="text-xs">
                                                    {member.role_name || member.role_code}
                                                </Badge>
                                                <Badge variant={member.is_active ? 'default' : 'secondary'} className="text-xs">
                                                    {member.is_active ? 'Active' : 'Disabled'}
                                                </Badge>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </SheetContent>
                </Sheet>
            </CardContent>
        </Card>
    )
}
