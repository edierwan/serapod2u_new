'use client'

import { useState, useEffect, useMemo } from 'react'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  Plus,
  Edit,
  Users,
  UserPlus,
  Loader2,
  Building2,
  UserCheck,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Search,
  UserX,
  ArrowRight
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import UserDialogNew from '@/components/users/UserDialogNew'
import { createUserWithAuth, updateUserWithAuth } from '@/lib/actions'
import { compressAvatar, formatFileSize } from '@/lib/utils/imageCompression'
import type { User, Organization } from '@/types/user'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  setDepartmentActive,
  getUsersForOrgPicker,
  getDepartmentMembers,
  getOrgUsersForDepartmentManagement,
  getRolesForDepartmentManagement,
  bulkAssignUsersToDepartment,
  bulkMoveUsersToDepartment,
  bulkRemoveUsersFromDepartment,
  updateUserManager,
  createUserForDepartment,
  type Department,
  type DepartmentMember,
  type RoleOption,
  type CreateDepartmentPayload,
  type UpdateDepartmentPayload
} from '@/lib/actions/departments'

interface DepartmentsTabProps {
  organizationId: string
  canEdit: boolean
}

interface OrgUser {
  id: string
  full_name: string | null
  email: string
}

export default function DepartmentsTab({ organizationId, canEdit }: DepartmentsTabProps) {
  const { isReady, supabase, userProfile } = useSupabaseAuth()
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [showDisabled, setShowDisabled] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingDept, setEditingDept] = useState<Department | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([])
  const [confirmDisable, setConfirmDisable] = useState<{ dept: Department; userCount: number } | null>(null)
  const [membersOpen, setMembersOpen] = useState(false)
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null)
  const [members, setMembers] = useState<DepartmentMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [orgMembers, setOrgMembers] = useState<DepartmentMember[]>([])
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [bulkSearch, setBulkSearch] = useState('')
  const [bulkRoleFilter, setBulkRoleFilter] = useState('all')
  const [bulkDeptFilter, setBulkDeptFilter] = useState('all')
  const [selectedBulkUsers, setSelectedBulkUsers] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<{ type: 'assign' | 'move' | 'remove'; count: number } | null>(null)
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [creatingUser, setCreatingUser] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    dept_code: '',
    dept_name: '',
    manager_user_id: '',
    sort_order: ''
  })

  const { toast } = useToast()

  useEffect(() => {
    loadDepartments()
    loadUsers()
    loadRoles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, showDisabled])

  useEffect(() => {
    if (organizationId && isReady && supabase) {
      const fetchOrg = async () => {
        const { data } = await supabase.from('organizations').select('*').eq('id', organizationId).single()
        if (data) setCurrentOrg(data)
      }
      fetchOrg()
    }
  }, [organizationId, isReady, supabase])

  const loadDepartments = async () => {
    setLoading(true)
    const result = await listDepartments(organizationId, showDisabled)
    if (result.success && result.data) {
      setDepartments(result.data)
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to load departments',
        variant: 'destructive'
      })
    }
    setLoading(false)
  }

  const loadUsers = async () => {
    const result = await getUsersForOrgPicker(organizationId)
    if (result.success && result.data) {
      setOrgUsers(result.data)
    }
  }

  const loadRoles = async () => {
    const result = await getRolesForDepartmentManagement()
    if (result.success && result.data) {
      setRoles(result.data)
    }
  }

  const loadMembers = async (dept: Department) => {
    setMembersLoading(true)
    const [membersResult, orgUsersResult] = await Promise.all([
      getDepartmentMembers(dept.id),
      getOrgUsersForDepartmentManagement(organizationId)
    ])

    if (membersResult.success && membersResult.data) {
      setMembers(membersResult.data)
    } else {
      toast({
        title: 'Error',
        description: membersResult.error || 'Failed to load members',
        variant: 'destructive'
      })
    }

    if (orgUsersResult.success && orgUsersResult.data) {
      setOrgMembers(orgUsersResult.data)
    }

    setMembersLoading(false)
  }

  const handleOpenMembers = async (dept: Department) => {
    setSelectedDepartment(dept)
    setMembersOpen(true)
    setSelectedBulkUsers(new Set())
    await loadMembers(dept)
  }

  const refreshMembers = async () => {
    if (selectedDepartment) {
      await loadMembers(selectedDepartment)
    }
    await loadDepartments()
  }

  const handleOpenDialog = (dept?: Department) => {
    if (dept) {
      setEditingDept(dept)
      setFormData({
        dept_code: dept.dept_code || '',
        dept_name: dept.dept_name,
        manager_user_id: dept.manager_user_id || '',
        sort_order: dept.sort_order?.toString() || ''
      })
    } else {
      setEditingDept(null)
      setFormData({
        dept_code: '',
        dept_name: '',
        manager_user_id: '',
        sort_order: ''
      })
    }
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formData.dept_name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Department name is required',
        variant: 'destructive'
      })
      return
    }

    setIsSaving(true)

    try {
      if (editingDept) {
        // Update existing
        const payload: UpdateDepartmentPayload = {
          dept_code: formData.dept_code || null,
          dept_name: formData.dept_name,
          manager_user_id: formData.manager_user_id || null,
          sort_order: formData.sort_order ? parseInt(formData.sort_order) : null
        }

        const result = await updateDepartment(editingDept.id, payload)

        if (result.success) {
          toast({
            title: 'Success',
            description: 'Department updated successfully'
          })
          setDialogOpen(false)
          loadDepartments()
        } else {
          toast({
            title: 'Error',
            description: result.error || 'Failed to update department',
            variant: 'destructive'
          })
        }
      } else {
        // Create new
        const payload: CreateDepartmentPayload = {
          dept_code: formData.dept_code || null,
          dept_name: formData.dept_name,
          manager_user_id: formData.manager_user_id || null,
          sort_order: formData.sort_order ? parseInt(formData.sort_order) : null
        }

        const result = await createDepartment(organizationId, payload)

        if (result.success) {
          toast({
            title: 'Success',
            description: 'Department created successfully'
          })
          setDialogOpen(false)
          loadDepartments()
        } else {
          toast({
            title: 'Error',
            description: result.error || 'Failed to create department',
            variant: 'destructive'
          })
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred',
        variant: 'destructive'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleActive = async (dept: Department) => {
    if (dept.is_active) {
      // Check for users before disabling
      if (dept.user_count && dept.user_count > 0) {
        setConfirmDisable({ dept, userCount: dept.user_count })
        return
      }
    }

    await toggleDepartmentStatus(dept)
  }

  const toggleDepartmentStatus = async (dept: Department) => {
    const result = await setDepartmentActive(dept.id, !dept.is_active)

    if (result.success) {
      toast({
        title: 'Success',
        description: `Department ${dept.is_active ? 'disabled' : 'enabled'} successfully`
      })
      loadDepartments()
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to update department status',
        variant: 'destructive'
      })
    }
  }

  const departmentMap = useMemo(() => {
    return departments.reduce((acc, dept) => {
      acc[dept.id] = dept
      return acc
    }, {} as Record<string, Department>)
  }, [departments])

  const activeDepartments = useMemo(() => departments.filter(d => d.is_active), [departments])

  const filteredBulkUsers = useMemo(() => {
    const search = bulkSearch.toLowerCase()
    return orgMembers.filter(user => {
      const matchesSearch =
        user.full_name?.toLowerCase().includes(search) ||
        user.email.toLowerCase().includes(search) ||
        (user.phone || '').toLowerCase().includes(search)

      const matchesRole = bulkRoleFilter === 'all' || user.role_code === bulkRoleFilter

      const matchesDept =
        bulkDeptFilter === 'all' ||
        (bulkDeptFilter === 'none'
          ? !user.department_id
          : user.department_id === bulkDeptFilter)

      return matchesSearch && matchesRole && matchesDept
    })
  }, [bulkSearch, bulkRoleFilter, bulkDeptFilter, orgMembers])

  const toggleBulkSelection = (userId: string) => {
    setSelectedBulkUsers(prev => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  const setAllBulkSelection = (checked: boolean) => {
    if (checked) {
      setSelectedBulkUsers(new Set(filteredBulkUsers.map(u => u.id)))
    } else {
      setSelectedBulkUsers(new Set())
    }
  }

  const handleBulkAction = (type: 'assign' | 'move' | 'remove') => {
    if (!selectedDepartment) return
    const count = selectedBulkUsers.size
    if (count === 0) {
      toast({
        title: 'No users selected',
        description: 'Select at least one user to continue.',
        variant: 'destructive'
      })
      return
    }
    setBulkAction({ type, count })
  }

  const confirmBulkAction = async () => {
    if (!selectedDepartment || !bulkAction) return

    const ids = Array.from(selectedBulkUsers)
    let result: { success: boolean; error?: string } = { success: false }

    if (bulkAction.type === 'assign') {
      result = await bulkAssignUsersToDepartment(selectedDepartment.id, ids)
    }

    if (bulkAction.type === 'move') {
      result = await bulkMoveUsersToDepartment(null, selectedDepartment.id, ids)
    }

    if (bulkAction.type === 'remove') {
      result = await bulkRemoveUsersFromDepartment(selectedDepartment.id, ids)
    }

    if (result.success) {
      toast({
        title: 'Success',
        description: 'Bulk update completed.'
      })
      setSelectedBulkUsers(new Set())
      await refreshMembers()
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Bulk update failed',
        variant: 'destructive'
      })
    }

    setBulkAction(null)
  }

  const handleRemoveMember = async (userId: string) => {
    if (!selectedDepartment) return
    const result = await bulkRemoveUsersFromDepartment(selectedDepartment.id, [userId])
    if (result.success) {
      toast({ title: 'Removed', description: 'User removed from department.' })
      await refreshMembers()
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to remove user', variant: 'destructive' })
    }
  }

  const handleMoveMember = async (userId: string, targetDeptId: string) => {
    if (!selectedDepartment) return
    const result = await bulkMoveUsersToDepartment(selectedDepartment.id, targetDeptId, [userId])
    if (result.success) {
      toast({ title: 'Moved', description: 'User moved to new department.' })
      await refreshMembers()
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to move user', variant: 'destructive' })
    }
  }

  const handleManagerUpdate = async (userId: string, managerId: string | null) => {
    const result = await updateUserManager(userId, managerId)
    if (result.success) {
      toast({ title: 'Updated', description: 'Manager updated.' })
      await refreshMembers()
    } else {
      toast({ title: 'Error', description: result.error || 'Failed to update manager', variant: 'destructive' })
    }
  }

  const handleSaveUser = async (
    userData: Partial<User> & { password?: string },
    avatarFile?: File | null
  ) => {
    if (!selectedDepartment) return

    try {
      setCreatingUser(true)

      // 1. Create User
      if (!userData.email || !userData.full_name || !userData.role_code || !userData.password) {
        throw new Error("Email, Name, Role, and Password are required")
      }

      const result = await createUserWithAuth({
        email: userData.email,
        password: userData.password,
        full_name: userData.full_name,
        role_code: userData.role_code,
        organization_id: organizationId,
        phone: userData.phone || undefined,
      })

      if (!result.success || !result.user_id) {
        throw new Error(result.error || "Failed to create user")
      }

      const userId = result.user_id

      // 2. Handle Avatar
      let avatarUrl = null
      if (avatarFile) {
        try {
          const compressionResult = await compressAvatar(avatarFile)
          const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`
          const filePath = `${userId}/${fileName}`

          const { error: uploadError } = await supabase.storage
            .from("avatars")
            .upload(filePath, compressionResult.file, {
              contentType: compressionResult.file.type,
              cacheControl: "3600",
              upsert: true,
            })

          if (!uploadError) {
            const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath)
            avatarUrl = urlData.publicUrl
          }
        } catch (e) {
          console.error("Avatar upload error", e)
        }
      }

      // 3. Update User with Dept, Manager & Avatar
      const updatePayload: any = {
        department_id: selectedDepartment.id,
        manager_user_id: userData.manager_user_id || undefined,
      }

      if (avatarUrl) {
        updatePayload.avatar_url = avatarUrl
      }

      // We user updateUserWithAuth to ensure permissions and proper logging if available
      // Or simply update via supabase if we trust the context (DepartmentsTab is usually admin)
      // updateUserWithAuth requires caller context.
      if (userProfile) {
        await updateUserWithAuth(userId, updatePayload, {
          id: userProfile.id,
          role_code: userProfile.role_code
        })
      } else {
        // Fallback if no profile?? Should not happen if authenticated.
        // Direct update via supabase as fallback (RLS permitting)
        await supabase.from('users').update(updatePayload).eq('id', userId)
      }

      toast({
        title: 'User created',
        description: 'User created successfully.',
      })
      setCreateUserOpen(false)
      await refreshMembers()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create user',
        variant: 'destructive'
      })
    } finally {
      setCreatingUser(false)
    }
  }

  // Filter departments by search
  const filteredDepartments = departments.filter(d => {
    const search = searchQuery.toLowerCase()
    return (
      d.dept_name.toLowerCase().includes(search) ||
      (d.dept_code && d.dept_code.toLowerCase().includes(search)) ||
      (d.manager?.full_name && d.manager.full_name.toLowerCase().includes(search))
    )
  })

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-600" />
                Departments
              </CardTitle>
              <CardDescription>
                Manage organizational departments for your organization
              </CardDescription>
            </div>
            {canEdit && (
              <Button onClick={() => handleOpenDialog()} className="sm:self-end">
                <Plus className="h-4 w-4 mr-2" />
                Add Department
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search departments..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="show-disabled"
                checked={showDisabled}
                onCheckedChange={setShowDisabled}
              />
              <Label htmlFor="show-disabled" className="text-sm text-gray-600">
                Show disabled
              </Label>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : filteredDepartments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchQuery ? 'No departments match your search' : 'No departments found'}
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Manager</TableHead>
                    <TableHead className="text-center w-[90px]">Users</TableHead>
                    <TableHead className="text-center w-[80px]">Order</TableHead>
                    <TableHead className="text-center w-[80px]">Status</TableHead>
                    {canEdit && <TableHead className="w-[140px]">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDepartments.map((dept) => (
                    <TableRow key={dept.id} className={!dept.is_active ? 'opacity-50 bg-gray-50' : ''}>
                      <TableCell className="font-mono text-sm">
                        {dept.dept_code || '-'}
                      </TableCell>
                      <TableCell className="font-medium">{dept.dept_name}</TableCell>
                      <TableCell>
                        {dept.manager ? (
                          <div className="flex items-center gap-2">
                            <UserCheck className="h-4 w-4 text-green-600" />
                            <span>{dept.manager.full_name || dept.manager.email}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400">Not assigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-2"
                          onClick={() => canEdit && handleOpenMembers(dept)}
                          disabled={!canEdit}
                        >
                          <Badge variant="secondary" className="font-mono">
                            {dept.user_count || 0}
                          </Badge>
                        </Button>
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {dept.sort_order ?? '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        {dept.is_active ? (
                          <Badge variant="default" className="bg-green-100 text-green-800">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-gray-100 text-gray-600">
                            Disabled
                          </Badge>
                        )}
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenMembers(dept)}
                              title="Manage members"
                            >
                              <Users className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenDialog(dept)}
                              title="Edit"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleActive(dept)}
                              title={dept.is_active ? 'Disable' : 'Enable'}
                            >
                              {dept.is_active ? (
                                <ToggleRight className="h-4 w-4 text-green-600" />
                              ) : (
                                <ToggleLeft className="h-4 w-4 text-gray-400" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingDept ? 'Edit Department' : 'Create Department'}
            </DialogTitle>
            <DialogDescription>
              {editingDept
                ? 'Update department details below'
                : 'Fill in the details for the new department'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dept_code">
                  Department Code
                  <span className="text-gray-400 text-xs ml-1">(optional)</span>
                </Label>
                <Input
                  id="dept_code"
                  value={formData.dept_code}
                  onChange={(e) => setFormData({ ...formData, dept_code: e.target.value.toUpperCase() })}
                  placeholder="e.g., HR, IT, FIN"
                  maxLength={20}
                />
                <p className="text-xs text-gray-500">
                  Short code for stable references (like SAP key)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sort_order">
                  Sort Order
                  <span className="text-gray-400 text-xs ml-1">(optional)</span>
                </Label>
                <Input
                  id="sort_order"
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
                  placeholder="e.g., 10, 20, 30"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dept_name">
                Department Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="dept_name"
                value={formData.dept_name}
                onChange={(e) => setFormData({ ...formData, dept_name: e.target.value })}
                placeholder="e.g., Human Resources"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="manager">
                Department Manager
                <span className="text-gray-400 text-xs ml-1">(optional)</span>
              </Label>
              <Select
                value={formData.manager_user_id}
                onValueChange={(value) => setFormData({ ...formData, manager_user_id: value === 'none' ? '' : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No manager</SelectItem>
                  {orgUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-gray-400" />
                        <span>{user.full_name || user.email}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                The manager will be used as fallback approver for users in this department
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingDept ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Department Members Modal */}
      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent className="sm:max-w-[1100px]">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  Department Members
                </DialogTitle>
                {selectedDepartment && (
                  <DialogDescription>
                    {selectedDepartment.dept_code ? `${selectedDepartment.dept_code} - ` : ''}{selectedDepartment.dept_name}
                    {' • '}
                    {selectedDepartment.is_active ? 'Active' : 'Disabled'}
                  </DialogDescription>
                )}
              </div>
              {canEdit && (
                <Button onClick={() => setCreateUserOpen(true)} size="sm">
                  <UserPlus className="h-4 w-4 mr-2" />
                  Create User
                </Button>
              )}
            </div>
          </DialogHeader>

          <Tabs defaultValue="members" className="w-full">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="members">Members</TabsTrigger>
              <TabsTrigger value="bulk">Bulk Assign</TabsTrigger>
            </TabsList>

            <TabsContent value="members">
              {membersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : members.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No members assigned to this department.
                </div>
              ) : (
                <div className="rounded-md border overflow-auto max-h-[50vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Reports To</TableHead>
                        <TableHead>Status</TableHead>
                        {canEdit && <TableHead className="text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map(member => (
                        <TableRow key={member.id}>
                          <TableCell className="font-medium">
                            {member.full_name || '-'}
                          </TableCell>
                          <TableCell>{member.email}</TableCell>
                          <TableCell>{member.phone || '-'}</TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span>{member.role_name || member.role_code}</span>
                              {member.role_level !== null && member.role_level !== undefined && (
                                <span className="text-xs text-gray-500">Level {member.role_level}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {canEdit ? (
                              <Select
                                value={member.manager_user_id || 'none'}
                                onValueChange={(value) =>
                                  handleManagerUpdate(member.id, value === 'none' ? null : value)
                                }
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue placeholder="No manager" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No Manager</SelectItem>
                                  {orgMembers
                                    .filter(u => u.id !== member.id)
                                    .map(u => (
                                      <SelectItem key={u.id} value={u.id}>
                                        {u.full_name || u.email}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            ) : member.manager ? (
                              <span>{member.manager.full_name || member.manager.email}</span>
                            ) : (
                              <span className="text-gray-400">Not assigned</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {member.is_active ? (
                              <Badge variant="default" className="bg-green-100 text-green-800">
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-gray-100 text-gray-600">
                                Disabled
                              </Badge>
                            )}
                          </TableCell>
                          {canEdit && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Select onValueChange={(value) => handleMoveMember(member.id, value)}>
                                  <SelectTrigger className="h-8 w-[150px]">
                                    <SelectValue placeholder="Move to..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {activeDepartments
                                      .filter(d => d.id !== selectedDepartment?.id)
                                      .map(d => (
                                        <SelectItem key={d.id} value={d.id}>
                                          {d.dept_code ? `${d.dept_code} - ` : ''}{d.dept_name}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveMember(member.id)}
                                  title="Remove from department"
                                >
                                  <UserX className="h-4 w-4 text-red-500" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="bulk">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search name, email, phone"
                      value={bulkSearch}
                      onChange={(e) => setBulkSearch(e.target.value)}
                      className="pl-9"
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
                          {role.role_name} (Level {role.role_level})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={bulkDeptFilter} onValueChange={setBulkDeptFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Filter by department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      <SelectItem value="none">No Department</SelectItem>
                      {departments.map(dept => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.dept_code ? `${dept.dept_code} - ` : ''}{dept.dept_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="rounded-md border overflow-auto max-h-[50vh]">
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
                        <TableHead>Email</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredBulkUsers.map(user => (
                        <TableRow key={user.id}>
                          <TableCell>
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={selectedBulkUsers.has(user.id)}
                              onChange={() => toggleBulkSelection(user.id)}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{user.full_name || '-'}</TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>{user.role_name || user.role_code}</TableCell>
                          <TableCell>
                            {user.department_id && departmentMap[user.department_id]
                              ? `${departmentMap[user.department_id].dept_code ? `${departmentMap[user.department_id].dept_code} - ` : ''}${departmentMap[user.department_id].dept_name}`
                              : 'No Department'}
                          </TableCell>
                          <TableCell>
                            {user.is_active ? (
                              <Badge variant="default" className="bg-green-100 text-green-800">Active</Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-gray-100 text-gray-600">Disabled</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredBulkUsers.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-gray-500 py-6">
                            No users match your filters.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-gray-500">
                    Selected: {selectedBulkUsers.size} user(s)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => handleBulkAction('assign')}>
                      Assign to {selectedDepartment?.dept_name || 'Department'}
                    </Button>
                    <Button variant="outline" onClick={() => handleBulkAction('move')}>
                      Move to {selectedDepartment?.dept_name || 'Department'}
                    </Button>
                    <Button variant="ghost" onClick={() => handleBulkAction('remove')}>
                      Remove from {selectedDepartment?.dept_name || 'Department'}
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Create User Dialog - rendered outside of the members modal to avoid z-index issues */}
      <UserDialogNew
        user={null}
        roles={roles as any[]}
        organizations={currentOrg ? [currentOrg] : []}
        open={createUserOpen}
        isSaving={creatingUser}
        currentUserRoleLevel={(userProfile as any)?.roles?.role_level || 100}
        lockOrganization={true}
        defaultValues={{
          organization_id: organizationId,
          department_id: selectedDepartment?.id
        }}
        onOpenChange={setCreateUserOpen}
        onSave={handleSaveUser}
      />

      {/* Bulk confirm dialog - higher z-index to appear above other dialogs */}
      <AlertDialog open={!!bulkAction} onOpenChange={() => setBulkAction(null)}>
        <AlertDialogContent className="z-[110]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ArrowRight className="h-5 w-5 text-blue-600" />
              Confirm bulk update
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkAction && selectedDepartment && (
                <span>
                  {bulkAction.type === 'assign' && `Assign ${bulkAction.count} user(s) to ${selectedDepartment.dept_name}.`}
                  {bulkAction.type === 'move' && `Move ${bulkAction.count} user(s) to ${selectedDepartment.dept_name}.`}
                  {bulkAction.type === 'remove' && `Remove ${bulkAction.count} user(s) from ${selectedDepartment.dept_name}.`}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBulkAction} className="bg-blue-600 hover:bg-blue-700">
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Disable Dialog */}
      <AlertDialog open={!!confirmDisable} onOpenChange={() => setConfirmDisable(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Department Has Active Users
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{confirmDisable?.dept.dept_name}</strong> currently has{' '}
              <strong>{confirmDisable?.userCount}</strong> active user(s) assigned.
              <br /><br />
              Please reassign these users to another department before disabling.
              This is to ensure all users maintain proper department assignments.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDisable?.dept) {
                  toggleDepartmentStatus(confirmDisable.dept)
                }
                setConfirmDisable(null)
              }}
              className="bg-amber-600 hover:bg-amber-700"
            >
              Disable Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
