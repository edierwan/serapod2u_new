'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { createUserWithAuth, deleteUserWithAuth } from '@/lib/actions'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Users, Search, Plus, Loader2, Edit, CheckCircle, XCircle, Trash2, ArrowUpDown, ArrowUp, ArrowDown, Power } from 'lucide-react'
import UserDialogNew from './UserDialogNew'
import type { User as UserType, Role, Organization } from '@/types/user'

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
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      loadUsers()
      loadRoles()
      loadOrganizations()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [isReady])

  const loadUsers = async () => {
    if (!isReady) return
    try {
      setLoading(true)
      
      // Super Admin and HQ Admin can see all users, others see only their org
      const isPowerUser = userProfile?.roles?.role_level <= 20
      
      let query = supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })
      
      // Filter by organization only for non-power users
      if (!isPowerUser) {
        query = query.eq('organization_id', userProfile.organization_id)
      }
      
      const { data, error } = await query
      
      if (error) throw error
      
      console.log('📊 Loaded users:', data?.length, 'users')
      setUsers((data || []) as User[])
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

  const handleSaveUser = async (userData: Partial<UserType> & { password?: string }, avatarFile?: File | null) => {
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
        
        // Handle avatar upload
        if (avatarFile) {
          try {
            // Delete old avatar if exists
            if (editingUser.avatar_url) {
              const oldPath = editingUser.avatar_url.split('/').pop()?.split('?')[0]
              if (oldPath) {
                await supabase.storage.from('avatars').remove([`${editingUser.id}/${oldPath}`])
              }
            }
            
            // Upload new avatar
            const fileExt = avatarFile.name.split('.').pop()
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
            const filePath = `${editingUser.id}/${fileName}`
            
            const { error: uploadError } = await supabase.storage
              .from('avatars')
              .upload(filePath, avatarFile, { 
                cacheControl: '3600',
                upsert: true 
              })
            
            if (uploadError) throw uploadError
            
            // Get public URL without cache-busting params (will be added in display)
            const { data: urlData } = supabase.storage
              .from('avatars')
              .getPublicUrl(filePath)
            
            updateData.avatar_url = urlData.publicUrl
          } catch (avatarError) {
            console.error('Avatar upload error:', avatarError)
            toast({ title: 'Warning', description: 'Avatar upload failed, but user data saved.', variant: 'default' })
          }
        }
        
        // Update user in database
        const { error: updateError } = await (supabase as any)
          .from('users')
          .update(updateData)
          .eq('id', editingUser.id)
        
        if (updateError) throw updateError
        
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
        
        if (!result.success) throw new Error(result.error || 'Failed to create user')
        
        // Upload avatar if provided
        if (avatarFile) {
          try {
            const fileExt = avatarFile.name.split('.').pop()
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
            const filePath = `${result.user_id}/${fileName}`
            
            const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, avatarFile, { 
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
            }
          } catch (avatarError) {
            console.error('Avatar upload error:', avatarError)
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
    .filter(user => 
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
    )
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

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
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
          {filteredUsers.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
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
                        <div className="flex items-center gap-3">
                          <Avatar className="w-10 h-10">
                            {user.avatar_url && (
                              <AvatarImage
                                src={`${user.avatar_url.split('?')[0]}?t=${new Date(user.updated_at).getTime()}`}
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
                            <div className="text-sm text-gray-500 truncate">{user.email}</div>
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
                            <span className="text-gray-400 italic">No Organization</span>
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
