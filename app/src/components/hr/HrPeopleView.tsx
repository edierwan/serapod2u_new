'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useToast } from '@/components/ui/use-toast'
import { Search, Users, UserCheck, Building2, Briefcase } from 'lucide-react'
import { listDepartments } from '@/lib/actions/departments'
import { fetchHrPositions, updateUserHr } from '@/lib/api/hr'

interface HrPeopleViewProps {
    organizationId: string
    canEdit: boolean
}

interface HrUserRow {
    id: string
    full_name: string | null
    email: string
    phone: string | null
    avatar_url: string | null
    role_code: string
    role_name: string | null
    role_level: number | null
    is_active: boolean
    department_id: string | null
    manager_user_id: string | null
    manager_name: string | null
    position_id: string | null
    position_name: string | null
}

export default function HrPeopleView({ organizationId, canEdit }: HrPeopleViewProps) {
    const { supabase, isReady } = useSupabaseAuth()
    const { toast } = useToast()

    const [users, setUsers] = useState<HrUserRow[]>([])
    const [departments, setDepartments] = useState<{ id: string; dept_name: string; dept_code: string | null }[]>([])
    const [positions, setPositions] = useState<{ id: string; name: string }[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [departmentFilter, setDepartmentFilter] = useState('all')
    const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())
    const [bulkDepartment, setBulkDepartment] = useState('none')
    const [bulkPosition, setBulkPosition] = useState('none')
    const [bulkManager, setBulkManager] = useState('none')

    const loadUsers = async () => {
        if (!isReady) return
        setLoading(true)

        const { data, error } = await (supabase as any)
            .from('users')
            .select(`
                id,
                full_name,
                email,
                phone,
                avatar_url,
                role_code,
                is_active,
                department_id,
                manager_user_id,
                position_id,
                roles:role_code (role_name, role_level),
                positions:position_id (name)
            `)
            .eq('organization_id', organizationId)
            .order('full_name', { ascending: true })

        if (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' })
            setLoading(false)
            return
        }

        const managerIds = Array.from(
            new Set((data || []).map((u: any) => u.manager_user_id).filter(Boolean))
        ) as string[]

        const managerMap = new Map<string, string | null>()
        if (managerIds.length > 0) {
            const { data: managers, error: managerError } = await (supabase as any)
                .from('users')
                .select('id, full_name')
                .in('id', managerIds)

            if (managerError) {
                toast({ title: 'Warning', description: managerError.message, variant: 'destructive' })
            } else {
                ; (managers || []).forEach((m: any) => managerMap.set(m.id, m.full_name || null))
            }
        }

        const mapped = (data || []).map((u: any) => {
            return {
                id: u.id,
                full_name: u.full_name,
                email: u.email,
                phone: u.phone,
                avatar_url: u.avatar_url,
                role_code: u.role_code,
                role_name: u.roles?.role_name || null,
                role_level: u.roles?.role_level ?? null,
                is_active: u.is_active,
                department_id: u.department_id,
                manager_user_id: u.manager_user_id,
                manager_name: u.manager_user_id ? managerMap.get(u.manager_user_id) || null : null,
                position_id: u.position_id,
                position_name: u.positions?.name || null
            } as HrUserRow
        })

        setUsers(mapped)
        setLoading(false)
    }

    const loadFilters = async () => {
        const deptResult = await listDepartments(organizationId, true)
        if (deptResult.success && deptResult.data) {
            setDepartments(deptResult.data.map(d => ({ id: d.id, dept_name: d.dept_name, dept_code: d.dept_code })))
        }

        const posResult = await fetchHrPositions(true)
        if (posResult.success && posResult.data) {
            setPositions(posResult.data.map(p => ({ id: p.id, name: p.name })))
        }
    }

    useEffect(() => {
        loadUsers()
        loadFilters()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isReady, organizationId])

    const filteredUsers = useMemo(() => {
        const query = searchQuery.trim().toLowerCase()
        return users.filter(u => {
            if (departmentFilter !== 'all' && u.department_id !== departmentFilter) return false
            if (!query) return true
            return (
                (u.full_name || '').toLowerCase().includes(query) ||
                u.email.toLowerCase().includes(query) ||
                (u.position_name || '').toLowerCase().includes(query)
            )
        })
    }, [users, searchQuery, departmentFilter])

    const departmentById = useMemo(() => {
        const map = new Map<string, { id: string; dept_name: string; dept_code: string | null }>()
        departments.forEach(d => map.set(d.id, d))
        return map
    }, [departments])

    const getDepartmentLabel = (departmentId: string | null) => {
        if (!departmentId) return 'No dept'
        const dept = departmentById.get(departmentId)
        if (!dept) return 'No dept'
        return `${dept.dept_code ? `${dept.dept_code} - ` : ''}${dept.dept_name}`
    }

    const toggleSelectAll = (checked: boolean) => {
        if (!checked) {
            setSelectedUsers(new Set())
            return
        }
        setSelectedUsers(new Set(filteredUsers.map(u => u.id)))
    }

    const toggleSelectUser = (userId: string, checked: boolean) => {
        const next = new Set(selectedUsers)
        if (checked) next.add(userId)
        else next.delete(userId)
        setSelectedUsers(next)
    }

    const applyBulkUpdate = async () => {
        if (!canEdit || selectedUsers.size === 0) return

        const updates = Array.from(selectedUsers).map(userId =>
            updateUserHr(userId, {
                department_id: bulkDepartment === 'none' ? undefined : bulkDepartment === 'clear' ? null : bulkDepartment,
                position_id: bulkPosition === 'none' ? undefined : bulkPosition === 'clear' ? null : bulkPosition,
                manager_user_id: bulkManager === 'none' ? undefined : bulkManager === 'clear' ? null : bulkManager
            })
        )

        const results = await Promise.all(updates)
        const failed = results.find(r => !r.success)

        if (failed) {
            toast({ title: 'Error', description: failed.error || 'Failed to update users', variant: 'destructive' })
        } else {
            toast({ title: 'Updated', description: 'Users updated.' })
            setSelectedUsers(new Set())
            setBulkDepartment('none')
            setBulkPosition('none')
            setBulkManager('none')
            loadUsers()
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>People</CardTitle>
                <CardDescription>Employees and reporting lines</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col md:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder="Search employees..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                    <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                        <SelectTrigger className="w-[220px]">
                            <SelectValue placeholder="Filter by department" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Departments</SelectItem>
                            {departments.map(dept => (
                                <SelectItem key={dept.id} value={dept.id}>
                                    {dept.dept_code ? `${dept.dept_code} - ` : ''}{dept.dept_name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {selectedUsers.size > 0 && (
                    <div className="flex flex-col lg:flex-row lg:items-center gap-3 p-3 border rounded-md bg-blue-50">
                        <div className="text-sm font-medium text-blue-900">
                            {selectedUsers.size} selected
                        </div>
                        <div className="flex flex-wrap items-end gap-3">
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-blue-800">Department</label>
                                <Select value={bulkDepartment} onValueChange={setBulkDepartment}>
                                    <SelectTrigger className="w-[200px]">
                                        <SelectValue placeholder="No change" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">No change</SelectItem>
                                        <SelectItem value="clear">Clear department</SelectItem>
                                        {departments.map(dept => (
                                            <SelectItem key={dept.id} value={dept.id}>
                                                {dept.dept_code ? `${dept.dept_code} - ` : ''}{dept.dept_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-blue-800">Position</label>
                                <Select value={bulkPosition} onValueChange={setBulkPosition}>
                                    <SelectTrigger className="w-[200px]">
                                        <SelectValue placeholder="No change" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">No change</SelectItem>
                                        <SelectItem value="clear">Clear position</SelectItem>
                                        {positions.map(position => (
                                            <SelectItem key={position.id} value={position.id}>
                                                {position.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-blue-800">Reports To</label>
                                <Select value={bulkManager} onValueChange={setBulkManager}>
                                    <SelectTrigger className="w-[200px]">
                                        <SelectValue placeholder="No change" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">No change</SelectItem>
                                        <SelectItem value="clear">Set as top leader</SelectItem>
                                        {users.map(user => (
                                            <SelectItem key={user.id} value={user.id}>
                                                {user.full_name || user.email}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button onClick={applyBulkUpdate} disabled={!canEdit}>
                                Apply
                            </Button>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="py-8 text-center text-gray-500">Loading employees...</div>
                ) : (
                    <div className="rounded-md border overflow-auto">
                        <div className="grid grid-cols-[40px_1fr_1fr_1fr_1fr_100px_80px] gap-2 px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-600 min-w-[900px]">
                            <div>
                                <Checkbox
                                    checked={selectedUsers.size > 0 && selectedUsers.size === filteredUsers.length}
                                    onCheckedChange={(checked) => toggleSelectAll(checked as boolean)}
                                />
                            </div>
                            <div>Name</div>
                            <div>Department</div>
                            <div>Position</div>
                            <div>Reports To</div>
                            <div>Role</div>
                            <div>Status</div>
                        </div>
                        {filteredUsers.map(user => (
                            <div key={user.id} className="grid grid-cols-[40px_1fr_1fr_1fr_1fr_100px_80px] gap-2 px-4 py-3 border-t items-center min-w-[900px]">
                                <div>
                                    <Checkbox
                                        checked={selectedUsers.has(user.id)}
                                        onCheckedChange={(checked) => toggleSelectUser(user.id, checked as boolean)}
                                    />
                                </div>
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-8 w-8">
                                        <AvatarImage src={user.avatar_url || undefined} alt={user.full_name || 'User'} />
                                        <AvatarFallback>{(user.full_name || user.email).split(' ').map(n => n[0]).join('').slice(0, 2)}</AvatarFallback>
                                    </Avatar>
                                    <div className="min-w-0">
                                        <div className="font-medium truncate">{user.full_name || 'Unknown'}</div>
                                        <div className="text-xs text-gray-500 truncate">{user.email}</div>
                                    </div>
                                </div>
                                <div className="text-sm text-gray-600 flex items-center gap-1">
                                    <Building2 className="h-3 w-3" />
                                    <span className="truncate">{getDepartmentLabel(user.department_id)}</span>
                                </div>
                                <div className="text-sm text-gray-600 flex items-center gap-1">
                                    <Briefcase className="h-3 w-3" />
                                    <span className="truncate">{user.position_name || 'No position'}</span>
                                </div>
                                <div className="text-sm text-gray-600 flex items-center gap-1">
                                    <UserCheck className="h-3 w-3" />
                                    <span className="truncate">{user.manager_name || 'Top leader'}</span>
                                </div>
                                <div className="text-sm text-gray-600">{user.role_name || user.role_code}</div>
                                <div>
                                    <Badge variant={user.is_active ? 'default' : 'secondary'}>
                                        {user.is_active ? 'Active' : 'Disabled'}
                                    </Badge>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
