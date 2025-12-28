'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { createUserWithAuth, deleteUserWithAuth, updateUserWithAuth } from '@/lib/actions'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { Users, Search, Plus, Loader2, Edit, CheckCircle, XCircle, Trash2, ArrowUpDown, ArrowUp, ArrowDown, Power } from 'lucide-react'
import UserDialogNew from './UserDialogNew'
import type { User as UserType, Role, Organization } from '@/types/user'
import { getStorageUrl } from '@/lib/utils'
import { compressAvatar, formatFileSize } from '@/lib/utils/imageCompression'

const formatRelativeTime = (dateString: string | null): string => {
  if (!dateString) return 'Never'
  try {
    const date = new Date(dateString)
    const now = new Date()
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    const months = Math.floor(days / 30)
    if (months < 12) return `${months}mo ago`
    return `${Math.floor(months / 12)}y ago`
  } catch { return 'Unknown' }
}

interface User {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  is_active: boolean
  is_verified: boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
  avatar_url: string | null
  role_code: string
  organization_id: string
}

interface UserProfile {
  id: string
  role_code: string
  organization_id: string
  roles: { role_level: number }
}

type SortField = 'full_name' | 'role_code' | 'is_active' | 'organization_id' | 'created_at' | 'last_login_at'
type SortDirection = 'asc' | 'desc'

export default function UserManagementNew({ userProfile }: { userProfile: UserProfile }) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [orgFilter, setOrgFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [orgTypeFilter, setOrgTypeFilter] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadUsers()
      loadRoles()
      loadOrganizations()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  const loadUsers = async () => {
    if (!isReady) return
    try {
      setLoading(true)

      // Super Admin and HQ Admin can see all users, others see only their org
      const isPowerUser = userProfile?.roles?.role_level <= 20
      const currentUserLevel = userProfile?.roles?.role_level || 999

      let query = supabase
        .from('users')
        .select(`
          *,
          roles:role_code (
            role_name,
            role_level
          )
        `)
        .order('created_at', { ascending: false })

      // Filter by organization only for non-power users
      if (!isPowerUser) {
        query = query.eq('organization_id', userProfile.organization_id)
      }

      const { data, error } = await query

      if (error) throw error

      // Filter users based on role level visibility
      // Users can only see other users with role_level >= their own role_level
      // (Lower number means higher rank, so they can see equal or lower rank)
      const visibleUsers = (data || []).filter((u: any) => {
        const userRoleLevel = u.roles?.role_level || 999
        return userRoleLevel >= currentUserLevel
      })

      console.log('📊 Loaded users:', visibleUsers.length, 'users (filtered from', data?.length, ')')
      setUsers(visibleUsers as User[])
    } catch (error) {
      console.error('Error loading users:', error)
      toast({ title: 'Load Failed', description: 'Could not load users. Please refresh.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const loadRoles = async () => {
    try {
      const { data, error } = await supabase
        .from('roles')
        .select('role_code, role_name, role_level')
        .eq('is_active', true)
        .order('role_level', { ascending: true })

      if (error) throw error
      setRoles((data || []) as Role[])
    } catch (error) {
      console.error('Error loading roles:', error)
    }
  }

  const loadOrganizations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_name, org_code, org_type_code')
        .eq('is_active', true)
        .order('org_name', { ascending: true })

      if (error) throw error
      setOrganizations((data || []) as Organization[])
    } catch (error) {
      console.error('Error loading organizations:', error)
    }
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction if clicking same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // Set new field with default ascending direction
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      // Select all filtered users except current user
      const newSelected = new Set(filteredUsers.filter(u => u.id !== userProfile.id).map(u => u.id))
      setSelectedUsers(newSelected)
    } else {
      setSelectedUsers(new Set())
    }
  }

  const handleSelectUser = (userId: string, checked: boolean) => {
    const newSelected = new Set(selectedUsers)
    if (checked) {
      newSelected.add(userId)
    } else {
      newSelected.delete(userId)
    }
    setSelectedUsers(newSelected)
  }

  const handleBulkDelete = async () => {
    if (selectedUsers.size === 0) return

    const confirmed = confirm(
      `Are you sure you want to delete ${selectedUsers.size} user${selectedUsers.size > 1 ? 's' : ''}? This action cannot be undone.`
    )

    if (!confirmed) return

    try {
      setIsSaving(true)
      let successCount = 0
      let errorCount = 0

      for (const userId of Array.from(selectedUsers)) {
        try {
          const result = await deleteUserWithAuth(userId, {
            id: userProfile.id,
            role_code: userProfile.role_code
          })
          if (result.success) {
            successCount++
          } else {
            errorCount++
          }
        } catch (error) {
          errorCount++
        }
      }

      if (successCount > 0) {
        toast({
          title: 'Bulk Delete Complete',
          description: `Successfully deleted ${successCount} user${successCount > 1 ? 's' : ''}${errorCount > 0 ? `. ${errorCount} failed.` : ''}`,
          variant: errorCount > 0 ? 'default' : 'default'
        })
      } else {
        toast({
          title: 'Delete Failed',
          description: 'Failed to delete selected users',
          variant: 'destructive'
        })
      }

      setSelectedUsers(new Set())
      await loadUsers()
    } catch (error) {
      console.error('Bulk delete error:', error)
      toast({
        title: 'Error',
        description: 'An error occurred during bulk delete',
        variant: 'destructive'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveUser = async (userData: Partial<UserType> & { password?: string }, avatarFile?: File | null, resetPassword?: { password: string }) => {
    try {
      setIsSaving(true)

      if (editingUser) {
        // UPDATE existing user
        let updateData: any = {
          full_name: userData.full_name,
          phone: userData.phone,
          role_code: userData.role_code,
          organization_id: userData.organization_id,
          is_active: userData.is_active ?? true,
        }

        // Handle password reset (Super Admin only)
        if (resetPassword && resetPassword.password) {
          try {
            const response = await fetch('/api/users/reset-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user_id: editingUser.id,
                new_password: resetPassword.password
              })
            })

            const result = await response.json()

            if (!response.ok || !result.success) {
              throw new Error(result.error || 'Failed to reset password')
            }

            toast({
              title: 'Password Reset',
              description: 'User password has been reset successfully',
              variant: 'default'
            })
          } catch (resetError: any) {
            console.error('Password reset error:', resetError)
            toast({
              title: 'Password Reset Failed',
              description: resetError.message || 'Failed to reset password',
              variant: 'destructive'
            })
            // Don't throw - continue with other updates
          }
        }

        // Handle Bank Details Update (if provided)
        if ((userData as any).bank_id || (userData as any).bank_account_number) {
          try {
            const bankResponse = await fetch('/api/organization/update-bank-details', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                organizationId: userData.organization_id,
                bankId: (userData as any).bank_id,
                bankAccountNumber: (userData as any).bank_account_number,
                bankAccountHolderName: (userData as any).bank_account_holder_name
              })
            })

            if (!bankResponse.ok) {
              const errorData = await bankResponse.json()
              throw new Error(errorData.error || 'Failed to update bank details')
            }
          } catch (bankError: any) {
            console.error('Error updating bank details:', bankError)
            toast({
              title: 'Bank Details Update Failed',
              description: bankError.message || 'Failed to update bank details',
              variant: 'destructive'
            })
            // Continue with user update
          }
        }

        // Handle avatar upload
        if (avatarFile) {
          try {
            // Compress avatar first
            const compressionResult = await compressAvatar(avatarFile)

            toast({
              title: '🖼️ Avatar Compressed',
              description: `${formatFileSize(compressionResult.originalSize)} → ${formatFileSize(compressionResult.compressedSize)} (${compressionResult.compressionRatio.toFixed(1)}% smaller)`,
            })

            // Delete old avatar if exists
            if (editingUser.avatar_url) {
              const oldPath = editingUser.avatar_url.split('/').pop()?.split('?')[0]
              if (oldPath) {
                await supabase.storage.from('avatars').remove([`${editingUser.id}/${oldPath}`])
              }
            }

            // Upload new avatar
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`
            const filePath = `${editingUser.id}/${fileName}`

            const { error: uploadError } = await supabase.storage
              .from('avatars')
              .upload(filePath, compressionResult.file, {
                contentType: compressionResult.file.type,
                cacheControl: '3600',
                upsert: true
              })

            if (uploadError) {
              console.error('Avatar upload error:', uploadError)
              const errorMsg = uploadError.message?.includes('maximum allowed size')
                ? 'Avatar upload failed. Image should auto-compress to ~10KB. Please try a different image.'
                : `Avatar upload failed: ${uploadError.message}`
              throw new Error(errorMsg)
            }

            // Get public URL without cache-busting params (will be added in display)
            const { data: urlData } = supabase.storage
              .from('avatars')
              .getPublicUrl(filePath)

            updateData.avatar_url = urlData.publicUrl
          } catch (avatarError: any) {
            console.error('Avatar upload error:', avatarError)
            toast({
              title: 'Warning',
              description: avatarError.message || 'Avatar upload failed, but user data saved.',
              variant: 'default'
            })
          }
        }

        // Update user in database
        const result = await updateUserWithAuth(editingUser.id, updateData, {
          id: userProfile.id,
          role_code: userProfile.role_code
        })

        if (!result.success) throw new Error(result.error || 'Failed to update user')

        toast({ title: 'Success', description: `${userData.full_name} updated successfully` })
        setDialogOpen(false)
        setEditingUser(null)
        await loadUsers()

      } else {
        // CREATE new user
        if (!userData.email || !userData.full_name || !userData.role_code || !userData.password) {
          throw new Error('Email, Name, Role, and Password are required')
        }

        const result = await createUserWithAuth({
          email: userData.email,
          password: userData.password,
          full_name: userData.full_name,
          role_code: userData.role_code,
          organization_id: userData.organization_id || userProfile.organization_id,
          phone: userData.phone || undefined
        })

        if (!result.success) {
          // Provide friendly error messages for common errors
          let errorMessage = result.error || 'Failed to create user'

          if (errorMessage.toLowerCase().includes('already been registered') ||
            errorMessage.toLowerCase().includes('already exists') ||
            errorMessage.toLowerCase().includes('duplicate')) {
            errorMessage = `The email address "${userData.email}" is already registered in the system. Please use a different email address.`
          }

          throw new Error(errorMessage)
        }

        // Handle Bank Details Update (if provided)
        if ((userData as any).bank_id || (userData as any).bank_account_number) {
          try {
            const bankResponse = await fetch('/api/organization/update-bank-details', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                organizationId: userData.organization_id || userProfile.organization_id,
                bankId: (userData as any).bank_id,
                bankAccountNumber: (userData as any).bank_account_number,
                bankAccountHolderName: (userData as any).bank_account_holder_name
              })
            })

            if (!bankResponse.ok) {
              const errorData = await bankResponse.json()
              throw new Error(errorData.error || 'Failed to update bank details')
            }
          } catch (bankError: any) {
            console.error('Error updating bank details:', bankError)
            toast({
              title: 'Bank Details Update Failed',
              description: bankError.message || 'Failed to update bank details',
              variant: 'destructive'
            })
          }
        }

        // Upload avatar if provided
        if (avatarFile) {
          try {
            // Compress avatar first
            const compressionResult = await compressAvatar(avatarFile)

            toast({
              title: '🖼️ Avatar Compressed',
              description: `${formatFileSize(compressionResult.originalSize)} → ${formatFileSize(compressionResult.compressedSize)} (${compressionResult.compressionRatio.toFixed(1)}% smaller)`,
            })

            const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`
            const filePath = `${result.user_id}/${fileName}`

            const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, compressionResult.file, {
              contentType: compressionResult.file.type,
              cacheControl: '3600',
              upsert: true
            })

            if (!uploadError) {
              const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath)

              // Store clean URL without cache-busting params
              const { error: updateError } = await (supabase as any)
                .from('users')
                .update({ avatar_url: urlData.publicUrl })
                .eq('id', result.user_id)

              if (updateError) {
                console.error('Avatar URL update error:', updateError)
              }
            } else {
              console.error('Avatar upload error:', uploadError)
              const errorMsg = uploadError.message?.includes('maximum allowed size')
                ? 'Avatar upload failed. Image should auto-compress to ~10KB. Please try a different image.'
                : `Avatar upload failed: ${uploadError.message}`
              toast({
                title: 'Avatar Upload Warning',
                description: errorMsg,
                variant: 'default'
              })
            }
          } catch (avatarError: any) {
            console.error('Avatar upload error:', avatarError)
            toast({
              title: 'Avatar Upload Warning',
              description: avatarError.message || 'Failed to upload avatar',
              variant: 'default'
            })
          }
        }

        console.log('✅ User created successfully, reloading user list...')
        toast({ title: 'Success', description: `${userData.full_name} created successfully` })
        setDialogOpen(false)

        // Small delay to ensure database transaction completes
        await new Promise(resolve => setTimeout(resolve, 500))

        // Force reload users to update the list
        await loadUsers()
        console.log('🔄 User list reloaded after creation')
      }
    } catch (error) {
      console.error('❌ Error saving user:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save user',
        variant: 'destructive'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleActive = async (userId: string, currentStatus: boolean, userName: string) => {
    try {
      setIsSaving(true)

      const { error } = await (supabase as any)
        .from('users')
        .update({ is_active: !currentStatus })
        .eq('id', userId)

      if (error) throw error

      toast({
        title: 'Success',
        description: `${userName} ${!currentStatus ? 'activated' : 'deactivated'} successfully`
      })

      await loadUsers()
    } catch (error) {
      console.error('Error toggling user status:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update user status',
        variant: 'destructive'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (!confirm(`Are you sure you want to delete user "${userName}"?\n\nThis will:\n• Remove user from database\n• Delete from Supabase Auth\n• Remove all related data\n\nThis action cannot be undone.`)) {
      return
    }

    try {
      setIsSaving(true)

      const result = await deleteUserWithAuth(userId)

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete user')
      }

      toast({
        title: 'Success',
        description: result.warning || `${userName} deleted successfully`
      })

      await loadUsers()
    } catch (error) {
      console.error('Error deleting user:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete user',
        variant: 'destructive'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const filteredUsers = users
    .filter(user => {
      // Search filter
      const matchesSearch = user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase())

      // Role filter
      const matchesRole = !roleFilter || user.role_code === roleFilter

      // Organization filter
      const matchesOrg = !orgFilter || user.organization_id === orgFilter

      // Organization Type filter
      const userOrg = organizations.find(o => o.id === user.organization_id)
      const matchesOrgType = !orgTypeFilter ||
        (orgTypeFilter === 'CUSTOMER' && !user.organization_id) ||
        (userOrg && userOrg.org_type_code === orgTypeFilter)

      // Status filter
      const matchesStatus = !statusFilter ||
        (statusFilter === 'active' && user.is_active) ||
        (statusFilter === 'inactive' && !user.is_active) ||
        (statusFilter === 'verified' && user.is_verified) ||
        (statusFilter === 'unverified' && !user.is_verified)

      return matchesSearch && matchesRole && matchesOrg && matchesOrgType && matchesStatus
    })
    .sort((a, b) => {
      let aVal: any = a[sortField]
      let bVal: any = b[sortField]

      // Handle null values
      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1

      // Handle different data types
      if (sortField === 'created_at' || sortField === 'last_login_at') {
        aVal = new Date(aVal).getTime()
        bVal = new Date(bVal).getTime()
      } else if (sortField === 'is_active') {
        aVal = aVal ? 1 : 0
        bVal = bVal ? 1 : 0
      } else if (sortField === 'full_name') {
        aVal = (aVal || '').toLowerCase()
        bVal = (bVal || '').toLowerCase()
      } else if (sortField === 'role_code') {
        aVal = roles.find(r => r.role_code === a.role_code)?.role_name || a.role_code
        bVal = roles.find(r => r.role_code === b.role_code)?.role_name || b.role_code
        aVal = aVal.toLowerCase()
        bVal = bVal.toLowerCase()
      } else if (sortField === 'organization_id') {
        aVal = organizations.find(o => o.id === a.organization_id)?.org_name || ''
        bVal = organizations.find(o => o.id === b.organization_id)?.org_name || ''
        aVal = aVal.toLowerCase()
        bVal = bVal.toLowerCase()
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

  const stats = {
    total: users.length,
    active: users.filter(u => u.is_active).length,
    verified: users.filter(u => u.is_verified).length
  }

  const getInitials = (name: string | null): string => {
    if (!name) return 'U'
    const parts = name.trim().split(' ')
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return name.substring(0, 2).toUpperCase()
  }

  const getRoleBadgeColor = (roleCode: string): string => {
    const colors: Record<string, string> = {
      'SUPER': 'bg-purple-100 text-purple-800',
      'HQ_ADMIN': 'bg-blue-100 text-blue-800',
      'MANU_ADMIN': 'bg-indigo-100 text-indigo-800',
      'DIST_ADMIN': 'bg-green-100 text-green-800',
      'WH_MANAGER': 'bg-orange-100 text-orange-800',
      'SHOP_MANAGER': 'bg-pink-100 text-pink-800',
      'USER': 'bg-gray-100 text-gray-800',
    }
    return colors[roleCode] || 'bg-gray-100 text-gray-800'
  }

  const getOrgTypeName = (orgTypeCode: string): string => {
    const typeNames: Record<string, string> = {
      'HQ': 'Headquarters',
      'MANU': 'Manufacturer',
      'MFG': 'Manufacturer',
      'DIST': 'Distributor',
      'WH': 'Warehouse',
      'SHOP': 'Shop',
    }
    return typeNames[orgTypeCode] || orgTypeCode
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-600">Manage system users and access permissions</p>
        </div>
        <Button
          onClick={() => { setEditingUser(null); setDialogOpen(true) }}
          className="bg-blue-600 hover:bg-blue-700"
          disabled={isSaving}
        >
          <Plus className="w-4 h-4 mr-2" />
          Add User
        </Button>
      </div>

      <UserDialogNew
        user={editingUser}
        roles={roles}
        organizations={organizations}
        open={dialogOpen}
        isSaving={isSaving}
        currentUserRoleLevel={userProfile?.roles?.role_level || 100}
        onOpenChange={setDialogOpen}
        onSave={handleSaveUser}
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Users</p>
                <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Active Users</p>
                <p className="text-3xl font-bold text-green-600">{stats.active}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-green-50 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Verified Users</p>
                <p className="text-3xl font-bold text-purple-600">{stats.verified}</p>
              </div>
              <div className="w-12 h-12 rounded-lg bg-purple-50 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Filters Row */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Role Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Role</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                onChange={(e) => setRoleFilter(e.target.value)}
                value={roleFilter}
              >
                <option value="">All Roles</option>
                {roles.map(role => (
                  <option key={role.role_code} value={role.role_code}>
                    {role.role_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Organization Type Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Organization Type</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                onChange={(e) => setOrgTypeFilter(e.target.value)}
                value={orgTypeFilter}
              >
                <option value="">All Types</option>
                <option value="CUSTOMER">End User</option>
                {Array.from(new Set(organizations.map(org => org.org_type_code)))
                  .filter((t): t is string => !!t)
                  .map(typeCode => (
                    <option key={typeCode} value={typeCode}>
                      {getOrgTypeName(typeCode)}
                    </option>
                  ))}
              </select>
            </div>

            {/* Organization Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Organization</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                onChange={(e) => setOrgFilter(e.target.value)}
                value={orgFilter}
              >
                <option value="">All Organizations</option>
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>
                    {org.org_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Status</label>
              <select
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                onChange={(e) => setStatusFilter(e.target.value)}
                value={statusFilter}
              >
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="verified">Verified</option>
                <option value="unverified">Unverified</option>
              </select>
            </div>


          </div>

          {/* Search Box */}
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-gray-400" />
            <Input
              placeholder="Search users by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardContent className="pt-6">
          {selectedUsers.size > 0 && (
            <div className="mb-4 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium text-blue-900">
                  {selectedUsers.size} user{selectedUsers.size > 1 ? 's' : ''} selected
                </span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={isSaving}
                className="gap-2"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Delete {selectedUsers.size} User{selectedUsers.size > 1 ? 's' : ''}
              </Button>
            </div>
          )}
          {filteredUsers.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={filteredUsers.filter(u => u.id !== userProfile.id).length > 0 && filteredUsers.filter(u => u.id !== userProfile.id).every(u => selectedUsers.has(u.id))}
                        onCheckedChange={handleSelectAll}
                        disabled={filteredUsers.filter(u => u.id !== userProfile.id).length === 0}
                      />
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort('full_name')}
                        className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium"
                      >
                        User
                        {sortField === 'full_name' ? (
                          sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                        ) : (
                          <ArrowUpDown className="w-4 h-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort('role_code')}
                        className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium"
                      >
                        Role
                        {sortField === 'role_code' ? (
                          sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                        ) : (
                          <ArrowUpDown className="w-4 h-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort('organization_id')}
                        className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium"
                      >
                        Organization
                        {sortField === 'organization_id' ? (
                          sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                        ) : (
                          <ArrowUpDown className="w-4 h-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort('created_at')}
                        className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium"
                      >
                        Join Date
                        {sortField === 'created_at' ? (
                          sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                        ) : (
                          <ArrowUpDown className="w-4 h-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort('last_login_at')}
                        className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium"
                      >
                        Last Login
                        {sortField === 'last_login_at' ? (
                          sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                        ) : (
                          <ArrowUpDown className="w-4 h-4 opacity-30" />
                        )}
                      </button>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => (
                    <TableRow key={user.id} className="hover:bg-gray-50">
                      <TableCell>
                        <Checkbox
                          checked={selectedUsers.has(user.id)}
                          onCheckedChange={(checked) => handleSelectUser(user.id, checked as boolean)}
                          disabled={user.id === userProfile.id}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10">
                            {user.avatar_url && (
                              <AvatarImage
                                src={getStorageUrl(`${user.avatar_url.split('?')[0]}?t=${new Date(user.updated_at).getTime()}`) || user.avatar_url}
                                alt={user.full_name || 'User'}
                                key={`avatar-${user.id}-${user.updated_at}`}
                              />
                            )}
                            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white text-xs font-medium">
                              {getInitials(user.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="text-gray-900 truncate font-medium">
                              {user.full_name || 'No Name'}
                            </div>
                            <div className="text-xs text-gray-500 truncate">
                              {user.email}
                              {user.phone && (
                                <span className="text-gray-400"> | {user.phone}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getRoleBadgeColor(user.role_code)}>
                          {roles.find(r => r.role_code === user.role_code)?.role_name || user.role_code}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          {organizations.find(o => o.id === user.organization_id) ? (
                            <span className="text-gray-900">
                              {getOrgTypeName(organizations.find(o => o.id === user.organization_id)?.org_type_code || '')}
                            </span>
                          ) : (
                            <span className="text-gray-400 italic">End User</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-gray-900">
                          {new Date(user.created_at).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                          })}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={user.last_login_at ? 'text-gray-900' : 'text-gray-400 italic'}>
                          {formatRelativeTime(user.last_login_at)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleActive(user.id, user.is_active, user.full_name || user.email)}
                            disabled={isSaving || user.id === userProfile.id}
                            className={user.is_active ? 'text-green-600 hover:text-green-700 hover:bg-green-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'}
                            title={user.id === userProfile.id ? "Cannot deactivate yourself" : (user.is_active ? "Deactivate user" : "Activate user")}
                          >
                            <Power className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setEditingUser(user); setDialogOpen(true) }}
                            disabled={isSaving}
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            title="Edit user"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteUser(user.id, user.full_name || user.email)}
                            disabled={isSaving || user.id === userProfile.id}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            title={user.id === userProfile.id ? "Cannot delete yourself" : "Delete user"}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No users found</h3>
              <p className="text-gray-600">
                {searchQuery ? 'No users match your search' : 'Start by adding your first user'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
