'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
} from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Building2,
  Users,
  UserCheck,
  UserPlus,
  UserMinus,
  Edit,
  Loader2,
  Search,
  RefreshCw,
  ArrowLeft,
  Calendar,
  ToggleLeft,
  ToggleRight,
  ArrowRightLeft,
  Trash2,
  ChevronRight,
  Network
} from 'lucide-react'
import {
  getDepartmentDetails,
  getDepartmentMembers,
  getOrgUsersForDepartmentManagement,
  getRolesForDepartmentManagement,
  updateDepartment,
  setDepartmentActive,
  bulkAssignUsersToDepartment,
  bulkRemoveUsersFromDepartment,
  bulkMoveUsersToDepartment,
  updateUserManager,
  assignUserDepartment,
  listDepartments,
  type Department,
  type DepartmentMember,
  type RoleOption,
  type UpdateDepartmentPayload
} from '@/lib/actions/departments'
import { formatDistanceToNow } from 'date-fns'

interface DepartmentDetailDrawerProps {
  departmentId: string | null
  organizationId: string
  open: boolean
  onClose: () => void
  canEdit: boolean
  onNavigateToChart?: () => void
  onRefresh?: () => void
}

export default function DepartmentDetailDrawer({
  departmentId,
  organizationId,
  open,
  onClose,
  canEdit,
  onNavigateToChart,
  onRefresh
}: DepartmentDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState('overview')
  const [department, setDepartment] = useState<(Department & { parent?: Department | null }) | null>(null)
  const [members, setMembers] = useState<DepartmentMember[]>([])
  const [allDepartments, setAllDepartments] = useState<Department[]>([])
  const [orgUsers, setOrgUsers] = useState<DepartmentMember[]>([])
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [loading, setLoading] = useState(true)
  const [membersLoading, setMembersLoading] = useState(false)

  // Bulk assign states
  const [searchQuery, setSearchQuery] = useState('')
  const [bulkSearch, setBulkSearch] = useState('')
  const [bulkRoleFilter, setBulkRoleFilter] = useState('all')
  const [bulkDeptFilter, setBulkDeptFilter] = useState('all')
  const [selectedBulkUsers, setSelectedBulkUsers] = useState<Set<string>>(new Set())

  // Confirm dialogs
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [confirmRemoveUser, setConfirmRemoveUser] = useState<DepartmentMember | null>(null)

  const { toast } = useToast()

  // Load department data
  const loadDepartment = useCallback(async () => {
    if (!departmentId) return
    setLoading(true)

    const [deptResult, deptsResult, rolesResult] = await Promise.all([
      getDepartmentDetails(departmentId),
      listDepartments(organizationId, true),
      getRolesForDepartmentManagement()
    ])

    if (deptResult.success && deptResult.data) {
      setDepartment(deptResult.data as (Department & { parent?: Department | null }))
    }

    if (deptsResult.success && deptsResult.data) {
      setAllDepartments(deptsResult.data)
    }

    if (rolesResult.success && rolesResult.data) {
      setRoles(rolesResult.data)
    }

    setLoading(false)
  }, [departmentId, organizationId])

  const loadMembers = useCallback(async () => {
    if (!departmentId) return
    setMembersLoading(true)

    const [membersResult, orgUsersResult] = await Promise.all([
      getDepartmentMembers(departmentId),
      getOrgUsersForDepartmentManagement(organizationId)
    ])

    if (membersResult.success && membersResult.data) {
      setMembers(membersResult.data)
    }

    if (orgUsersResult.success && orgUsersResult.data) {
      setOrgUsers(orgUsersResult.data)
    }

    setMembersLoading(false)
  }, [departmentId, organizationId])

  useEffect(() => {
    if (open && departmentId) {
      loadDepartment()
      loadMembers()
      setSelectedBulkUsers(new Set())
    }
  }, [open, departmentId, loadDepartment, loadMembers])

  // Filter users for bulk assign
  const filteredBulkUsers = useMemo(() => {
    const search = bulkSearch.toLowerCase()
    return orgUsers.filter(user => {
      const matchesSearch =
        (user.full_name?.toLowerCase() || '').includes(search) ||
        user.email.toLowerCase().includes(search)
      const matchesRole = bulkRoleFilter === 'all' || user.role_code === bulkRoleFilter
      const matchesDept =
        bulkDeptFilter === 'all' ||
        (bulkDeptFilter === 'none' && !user.department_id) ||
        user.department_id === bulkDeptFilter
      return matchesSearch && matchesRole && matchesDept
    })
  }, [orgUsers, bulkSearch, bulkRoleFilter, bulkDeptFilter])

  // Filter current members
  const filteredMembers = useMemo(() => {
    if (!searchQuery) return members
    const search = searchQuery.toLowerCase()
    return members.filter(m =>
      (m.full_name?.toLowerCase() || '').includes(search) ||
      m.email.toLowerCase().includes(search)
    )
  }, [members, searchQuery])

  const departmentMap = useMemo(() => {
    return allDepartments.reduce((acc, dept) => {
      acc[dept.id] = dept
      return acc
    }, {} as Record<string, Department>)
  }, [allDepartments])

  // Handlers
  const handleRefresh = async () => {
    await loadDepartment()
    await loadMembers()
    toast({ title: 'Refreshed', description: 'Department data updated' })
  }

  const handleToggleActive = async () => {
    if (!department) return

    if (department.is_active && members.length > 0) {
      setConfirmDisable(true)
      return
    }

    const result = await setDepartmentActive(department.id, !department.is_active)
    if (result.success) {
      toast({
        title: 'Success',
        description: `Department ${department.is_active ? 'disabled' : 'enabled'} successfully`
      })
      await loadDepartment()
      onRefresh?.()
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to update department status',
        variant: 'destructive'
      })
    }
  }

  const handleRemoveUser = async (user: DepartmentMember) => {
    const result = await assignUserDepartment(user.id, null)
    if (result.success) {
      toast({ title: 'Removed', description: `${user.full_name || user.email} removed from department` })
      await loadMembers()
      await loadDepartment()
      onRefresh?.()
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to remove user', variant: 'destructive' })
    }
    setConfirmRemoveUser(null)
  }

  const handleUpdateManager = async (userId: string, managerId: string | null) => {
    const result = await updateUserManager(userId, managerId)
    if (result.success) {
      toast({ title: 'Updated', description: 'Manager updated successfully' })
      await loadMembers()
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to update manager', variant: 'destructive' })
    }
  }

  // Bulk actions
  const toggleBulkSelection = (userId: string) => {
    const next = new Set(selectedBulkUsers)
    if (next.has(userId)) {
      next.delete(userId)
    } else {
      next.add(userId)
    }
    setSelectedBulkUsers(next)
  }

  const setAllBulkSelection = (selected: boolean) => {
    if (selected) {
      setSelectedBulkUsers(new Set(filteredBulkUsers.map(u => u.id)))
    } else {
      setSelectedBulkUsers(new Set())
    }
  }

  const handleBulkAssign = async () => {
    if (!departmentId || selectedBulkUsers.size === 0) return

    const result = await bulkAssignUsersToDepartment(departmentId, Array.from(selectedBulkUsers))
    if (result.success) {
      toast({
        title: 'Success',
        description: `${selectedBulkUsers.size} user(s) assigned to department`
      })
      setSelectedBulkUsers(new Set())
      await loadMembers()
      await loadDepartment()
      onRefresh?.()
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to assign users', variant: 'destructive' })
    }
  }

  const handleBulkRemove = async () => {
    if (!departmentId || selectedBulkUsers.size === 0) return

    const result = await bulkRemoveUsersFromDepartment(departmentId, Array.from(selectedBulkUsers))
    if (result.success) {
      toast({
        title: 'Success',
        description: `${selectedBulkUsers.size} user(s) removed from department`
      })
      setSelectedBulkUsers(new Set())
      await loadMembers()
      await loadDepartment()
      onRefresh?.()
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to remove users', variant: 'destructive' })
    }
  }

  if (!open) return null

  return (
    <>
      <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          {/* Header (always present for accessibility) */}
          <SheetHeader className="border-b pb-4 mb-4">
            {department ? (
              <div className="flex items-start justify-between">
                <div>
                  <SheetTitle className="flex items-center gap-2 text-xl">
                    <Building2 className="h-5 w-5 text-blue-600" />
                    {department.dept_name}
                    {department.dept_code && (
                      <Badge variant="secondary" className="ml-2 font-mono">
                        {department.dept_code}
                      </Badge>
                    )}
                  </SheetTitle>
                  <div className="mt-1 flex items-center gap-4">
                    {department.is_active ? (
                      <Badge className="bg-green-100 text-green-800">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-gray-100 text-gray-600">Disabled</Badge>
                    )}
                    {department.parent && (
                      <span className="flex items-center gap-1 text-sm text-gray-500">
                        <ChevronRight className="h-3 w-3" />
                        Parent: {(department.parent as any).dept_name}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {onNavigateToChart && (
                    <Button variant="outline" size="sm" onClick={onNavigateToChart}>
                      <Network className="h-4 w-4 mr-1" />
                      View in Chart
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={handleRefresh}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <SheetTitle className="text-xl">Department Details</SheetTitle>
                <div className="mt-1 text-sm text-gray-500">
                  {loading ? 'Loading department...' : 'Department not found'}
                </div>
              </div>
            )}
          </SheetHeader>

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : !department ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <Building2 className="h-12 w-12 mb-4 text-gray-300" />
              <p>Department not found</p>
              <Button variant="outline" onClick={onClose} className="mt-4">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Go Back
              </Button>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="members">Members ({members.length})</TabsTrigger>
                  <TabsTrigger value="assign">Assign Users</TabsTrigger>
                </TabsList>

                {/* Overview Tab */}
                <TabsContent value="overview" className="space-y-4 mt-4">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 gap-4">
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-100 rounded-lg">
                            <Users className="h-5 w-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-2xl font-bold">{members.length}</p>
                            <p className="text-sm text-gray-500">Members</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-green-100 rounded-lg">
                            <UserCheck className="h-5 w-5 text-green-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium truncate max-w-[120px]">
                              {(department as any).manager?.full_name || 'Not assigned'}
                            </p>
                            <p className="text-sm text-gray-500">Manager</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Details */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Department Details</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Sort Order</span>
                        <span>{department.sort_order || 'Not set'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Chart Order</span>
                        <span>{(department as any).chart_order || 'Not set'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Last Updated</span>
                        <span>{formatDistanceToNow(new Date(department.updated_at), { addSuffix: true })}</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Quick Actions */}
                  {canEdit && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">Quick Actions</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <Button
                          variant="outline"
                          className="w-full justify-start"
                          onClick={() => setActiveTab('assign')}
                        >
                          <UserPlus className="h-4 w-4 mr-2" />
                          Assign Users
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full justify-start"
                          onClick={handleToggleActive}
                        >
                          {department.is_active ? (
                            <>
                              <ToggleLeft className="h-4 w-4 mr-2" />
                              Disable Department
                            </>
                          ) : (
                            <>
                              <ToggleRight className="h-4 w-4 mr-2" />
                              Enable Department
                            </>
                          )}
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* Members Tab */}
                <TabsContent value="members" className="space-y-4 mt-4">
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search members..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10"
                    />
                  </div>

                  {/* Members Table */}
                  {membersLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                    </div>
                  ) : filteredMembers.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Users className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                      <p>No members in this department</p>
                      {canEdit && (
                        <Button variant="outline" size="sm" className="mt-2" onClick={() => setActiveTab('assign')}>
                          <UserPlus className="h-4 w-4 mr-2" />
                          Assign Users
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-md border overflow-auto max-h-[400px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Reports To</TableHead>
                            <TableHead>Status</TableHead>
                            {canEdit && <TableHead className="w-[80px]">Actions</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredMembers.map(member => (
                            <TableRow key={member.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{member.full_name || '-'}</p>
                                  <p className="text-xs text-gray-500">{member.email}</p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">
                                  {member.role_name || member.role_code}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {canEdit ? (
                                  <Select
                                    value={member.manager_user_id || 'none'}
                                    onValueChange={(val) => handleUpdateManager(member.id, val === 'none' ? null : val)}
                                  >
                                    <SelectTrigger className="h-8 text-xs w-[140px]">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="none">No manager</SelectItem>
                                      {orgUsers
                                        .filter(u => u.id !== member.id && u.is_active)
                                        .map(u => (
                                          <SelectItem key={u.id} value={u.id}>
                                            {u.full_name || u.email}
                                          </SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <span className="text-sm">
                                    {member.manager?.full_name || member.manager?.email || 'No manager'}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                {member.is_active ? (
                                  <Badge className="bg-green-100 text-green-800 text-xs">Active</Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-xs">Inactive</Badge>
                                )}
                              </TableCell>
                              {canEdit && (
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmRemoveUser(member)}
                                    title="Remove from department"
                                  >
                                    <UserMinus className="h-4 w-4 text-red-500" />
                                  </Button>
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>

                {/* Assign Users Tab */}
                <TabsContent value="assign" className="space-y-4 mt-4">
                  {!canEdit ? (
                    <div className="text-center py-8 text-gray-500">
                      You don't have permission to assign users
                    </div>
                  ) : (
                    <>
                      {/* Filters */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                          <Input
                            placeholder="Search..."
                            value={bulkSearch}
                            onChange={(e) => setBulkSearch(e.target.value)}
                            className="pl-10"
                          />
                        </div>
                        <Select value={bulkRoleFilter} onValueChange={setBulkRoleFilter}>
                          <SelectTrigger>
                            <SelectValue placeholder="Filter by role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Roles</SelectItem>
                            {roles.map(role => (
                              <SelectItem key={role.role_code} value={role.role_code}>
                                {role.role_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={bulkDeptFilter} onValueChange={setBulkDeptFilter}>
                          <SelectTrigger>
                            <SelectValue placeholder="Filter by dept" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Departments</SelectItem>
                            <SelectItem value="none">No Department</SelectItem>
                            {allDepartments.filter(d => d.id !== departmentId).map(dept => (
                              <SelectItem key={dept.id} value={dept.id}>
                                {dept.dept_code ? `${dept.dept_code} - ` : ''}{dept.dept_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Bulk Actions Bar */}
                      {selectedBulkUsers.size > 0 && (
                        <div className="flex items-center justify-between p-2 bg-blue-50 rounded-lg">
                          <span className="text-sm text-blue-700">
                            {selectedBulkUsers.size} user(s) selected
                          </span>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleBulkAssign}>
                              <UserPlus className="h-4 w-4 mr-1" />
                              Assign to Department
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setSelectedBulkUsers(new Set())}>
                              Clear
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Users Table */}
                      <div className="rounded-md border overflow-auto max-h-[400px]">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[40px]">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={selectedBulkUsers.size > 0 && selectedBulkUsers.size === filteredBulkUsers.length}
                                  onChange={(e) => setAllBulkSelection(e.target.checked)}
                                />
                              </TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead>Current Dept</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredBulkUsers.map(user => (
                              <TableRow key={user.id} className={user.department_id === departmentId ? 'opacity-50' : ''}>
                                <TableCell>
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4"
                                    checked={selectedBulkUsers.has(user.id)}
                                    onChange={() => toggleBulkSelection(user.id)}
                                    disabled={user.department_id === departmentId}
                                  />
                                </TableCell>
                                <TableCell>
                                  <div>
                                    <p className="font-medium">{user.full_name || '-'}</p>
                                    <p className="text-xs text-gray-500">{user.email}</p>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-xs">
                                    {user.role_name || user.role_code}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {user.department_id && departmentMap[user.department_id]
                                    ? departmentMap[user.department_id].dept_name
                                    : <span className="text-gray-400">No Department</span>
                                  }
                                  {user.department_id === departmentId && (
                                    <Badge className="ml-2 bg-blue-100 text-blue-700 text-xs">Current</Badge>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {user.is_active ? (
                                    <Badge className="bg-green-100 text-green-800 text-xs">Active</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-xs">Inactive</Badge>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Confirm Disable Dialog */}
      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Department?</AlertDialogTitle>
            <AlertDialogDescription>
              This department has {members.length} active member(s). 
              They will remain assigned but you should consider reassigning them first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const result = await setDepartmentActive(department!.id, false)
                if (result.success) {
                  toast({ title: 'Disabled', description: 'Department has been disabled' })
                  await loadDepartment()
                  onRefresh?.()
                }
                setConfirmDisable(false)
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Disable Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Remove User Dialog */}
      <AlertDialog open={!!confirmRemoveUser} onOpenChange={() => setConfirmRemoveUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from Department?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {confirmRemoveUser?.full_name || confirmRemoveUser?.email} from this department?
              They will be moved to "No Department".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRemoveUser && handleRemoveUser(confirmRemoveUser)}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
