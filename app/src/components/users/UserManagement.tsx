'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { createUserWithAuth } from '@/lib/actions'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Users, Search, Plus, Loader2, Edit, Trash2, CheckCircle, XCircle, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import UserDialog from './UserDialog'
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
    const years = Math.floor(months / 12)
    return `${years}y ago`
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

type SortField = 'name' | 'role' | 'organization' | 'status' | 'verified' | 'date_joined' | 'last_login'
type SortDirection = 'asc' | 'desc' | null

interface SortState {
  field: SortField | null
  direction: SortDirection
}

export default function UserManagement({ userProfile }: { userProfile: UserProfile }) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [sortState, setSortState] = useState<SortState>({ field: null, direction: null })
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ show: boolean; userId: string | null }>({ show: false, userId: null })
  const [avatarRefresh, setAvatarRefresh] = useState<Record<string, number>>({})
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  const roleMap = useMemo(() => {
    const map: Record<string, string> = {}
    roles.forEach(role => { map[role.role_code] = role.role_name })
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [roles])

  const orgMap = useMemo(() => {
    const map: Record<string, string> = {}
    organizations.forEach(org => { map[org.id] = org.org_name })
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [organizations])

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
      const { data, error } = await supabase.from('users').select('*').eq('organization_id', userProfile.organization_id).order('created_at', { ascending: false })
      if (error) throw error
      setUsers((data || []) as User[])
      // Force avatar refresh by incrementing counter
      setAvatarRefresh(prev => {
        const updated = { ...prev }
        ;(data || []).forEach(user => {
          updated[user.id] = Date.now()
        })
        return updated
      })
    } catch (error) {
      console.error('Error loading users:', error)
      toast({ title: 'Load Failed', description: 'Could not load users. Please refresh.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const loadRoles = async () => {
    try {
      const { data, error } = await supabase.from('roles').select('role_code, role_name, role_level').eq('is_active', true).order('role_level', { ascending: true })
      if (error) throw error
      setRoles((data || []) as Role[])
    } catch (error) {
      console.error('Error loading roles:', error)
    }
  }

  const loadOrganizations = async () => {
    try {
      const { data, error } = await supabase.from('organizations').select('id, org_name, org_code, org_type_code').eq('is_active', true).order('org_name', { ascending: true })
      if (error) throw error
      setOrganizations((data || []) as Organization[])
    } catch (error) {
      console.error('Error loading organizations:', error)
    }
  }

  const handleAddUser = async (userData: Partial<UserType> & { password?: string }, avatarFile?: File | null) => {
    try {
      setIsSaving(true)
      
      // If editing existing user
      if (editingUser) {
        let updateData: any = {
          full_name: userData.full_name,
          phone: userData.phone,
          role_code: userData.role_code,
          organization_id: userData.organization_id,
          is_active: userData.is_active ?? true,
          is_verified: userData.is_verified ?? false
        }
        
        // Handle avatar upload for edit
        if (avatarFile) {
          try {
            // Delete old avatar if exists
            if (editingUser.avatar_url) {
              const oldPath = editingUser.avatar_url.split('/').pop()?.split('?')[0]
              if (oldPath) {
                const pathToDelete = `${editingUser.id}/${oldPath}`
                await supabase.storage.from('avatars').remove([pathToDelete])
              }
            }
            
            const fileExtension = avatarFile.name.split('.').pop()
            const fileName = `${Date.now()}.${fileExtension}`
            const filePath = `${editingUser.id}/${fileName}`
            
            const { error: uploadError } = await supabase.storage
              .from('avatars')
              .upload(filePath, avatarFile, {
                cacheControl: '3600',
                upsert: true
              })
            
            if (uploadError) {
              console.error('Upload error:', uploadError)
              toast({ title: 'Warning', description: 'Avatar upload failed, but user data saved.', variant: 'default' })
            } else {
              const { data } = supabase.storage.from('avatars').getPublicUrl(filePath)
              updateData.avatar_url = data.publicUrl
            }
          } catch (avatarError) {
            console.error('Avatar upload error:', avatarError)
            toast({ title: 'Warning', description: 'Avatar upload failed, but user data saved.', variant: 'default' })
          }
        }
        
        const { error: updateError } = await supabase
          .from('users')
          .update(updateData)
          .eq('id', editingUser.id)
        
        if (updateError) throw updateError
        toast({ title: 'User Updated', description: `${userData.full_name} updated successfully` })
        setEditingUser(null)
        setDialogOpen(false)
        // Force immediate reload to show updated avatar
        await loadUsers()
      } else {
        // Creating new user
        if (!userData.email || !userData.full_name || !userData.role_code || !userData.password) {
          throw new Error('Email, Name, Role, and Password are all required')
        }
        
        // Check for duplicate email
        const { data: existingUser, error: checkError } = await supabase
          .from('users')
          .select('id, email')
          .ilike('email', userData.email.trim())
          .limit(1)
        
        if (checkError) {
          console.error('Error checking duplicate email:', checkError)
        }
        
        if (existingUser && existingUser.length > 0) {
          toast({
            title: 'Email Already Exists',
            description: `A user with the email "${userData.email}" already exists. Please use a different email.`,
            variant: 'destructive'
          })
          throw new Error('Email already exists')
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
        
        // Set last_login_at to creation time for new users
        await supabase
          .from('users')
          .update({ last_login_at: new Date().toISOString() })
          .eq('id', result.user_id)
        
        if (avatarFile) {
          try {
            const fileExtension = avatarFile.name.split('.').pop()
            const fileName = `${Date.now()}.${fileExtension}`
            const filePath = `${result.user_id}/${fileName}`
            
            const { error: uploadError } = await supabase.storage
              .from('avatars')
              .upload(filePath, avatarFile, {
                cacheControl: '3600',
                upsert: true
              })
            
            if (uploadError) {
              console.error('Upload error:', uploadError)
              toast({ title: 'Warning', description: 'User created but avatar upload failed.', variant: 'default' })
            } else {
              const { data } = supabase.storage.from('avatars').getPublicUrl(filePath)
              await supabase.from('users').update({ avatar_url: data.publicUrl }).eq('id', result.user_id)
            }
          } catch (avatarError) {
            console.error('Avatar upload error:', avatarError)
          }
        }
        
        toast({ title: 'User Created', description: `${userData.full_name} created successfully` })
        setDialogOpen(false)
        // Force immediate reload to show new user
        await loadUsers()
      }
    } catch (error) {
      console.error('Error saving user:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to save user'
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteUser = async (userId: string) => {
    try {
      setIsSaving(true)
      
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', userId)

      if (error) throw error

      toast({ title: 'User Deleted', description: 'User has been successfully deleted' })
      setDeleteConfirmation({ show: false, userId: null })
      await loadUsers()
    } catch (error) {
      console.error('Error deleting user:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete user'
      toast({ title: 'Error', description: errorMessage, variant: 'destructive' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleSort = (field: SortField) => {
    let newDirection: SortDirection = 'asc'
    if (sortState.field === field) {
      if (sortState.direction === 'asc') newDirection = 'desc'
      else if (sortState.direction === 'desc') newDirection = null
    }
    setSortState({ field: newDirection ? field : null, direction: newDirection })
  }

  const sortUsers = (userList: User[]): User[] => {
    if (!sortState.field || !sortState.direction) return userList
    return [...userList].sort((a, b) => {
      let aValue: any, bValue: any
      switch (sortState.field) {
        case 'name': aValue = a.full_name?.toLowerCase() || ''; bValue = b.full_name?.toLowerCase() || ''; break
        case 'role': aValue = roleMap[a.role_code]?.toLowerCase() || a.role_code.toLowerCase(); bValue = roleMap[b.role_code]?.toLowerCase() || b.role_code.toLowerCase(); break
        case 'organization': aValue = orgMap[a.organization_id]?.toLowerCase() || ''; bValue = orgMap[b.organization_id]?.toLowerCase() || ''; break
        case 'status': aValue = a.is_active ? 1 : 0; bValue = b.is_active ? 1 : 0; break
        case 'verified': aValue = a.is_verified ? 1 : 0; bValue = b.is_verified ? 1 : 0; break
        case 'date_joined': aValue = a.created_at ? new Date(a.created_at).getTime() : 0; bValue = b.created_at ? new Date(b.created_at).getTime() : 0; break
        case 'last_login': aValue = a.last_login_at ? new Date(a.last_login_at).getTime() : 0; bValue = b.last_login_at ? new Date(b.last_login_at).getTime() : 0; break
        default: return 0
      }
      if (aValue < bValue) return sortState.direction === 'asc' ? -1 : 1
      if (aValue > bValue) return sortState.direction === 'asc' ? 1 : -1
      return 0
    })
  }

  const filteredUsers = useMemo(() => {
    const filtered = users.filter(user => user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) || user.email.toLowerCase().includes(searchQuery.toLowerCase()))
    return sortUsers(filtered)
  // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [users, searchQuery, sortState, roleMap, orgMap])

  const stats = useMemo(() => ({ total: users.length, active: users.filter(u => u.is_active).length, verified: users.filter(u => u.is_verified).length }), [users])

  const getInitials = (name: string | null): string => {
    if (!name) return 'U'
    const parts = name.trim().split(' ')
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return name.substring(0, 2).toUpperCase()
  }

  const getRoleBadgeColor = (roleCode: string): string => {
    const colors: Record<string, string> = { 'SUPER': 'bg-purple-100 text-purple-800 border-purple-200', 'HQ_ADMIN': 'bg-blue-100 text-blue-800 border-blue-200', 'MANU_ADMIN': 'bg-indigo-100 text-indigo-800 border-indigo-200', 'DIST_ADMIN': 'bg-green-100 text-green-800 border-green-200', 'WH_MANAGER': 'bg-orange-100 text-orange-800 border-orange-200', 'SHOP_MANAGER': 'bg-pink-100 text-pink-800 border-pink-200', 'USER': 'bg-gray-100 text-gray-800 border-gray-200', 'GUEST': 'bg-yellow-100 text-yellow-800 border-yellow-200' }
    return colors[roleCode] || 'bg-gray-100 text-gray-800 border-gray-200'
  }

  const SortableHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => {
    const isActive = sortState.field === field
    const direction = isActive ? sortState.direction : null
    return <TableHead><Button variant="ghost" size="sm" className="-ml-3 h-8 hover:bg-gray-100" onClick={(e) => { e.stopPropagation(); handleSort(field) }}>
      <span className="text-gray-700 font-semibold">{children}</span>
      {!isActive && <ArrowUpDown className="ml-2 h-4 w-4 text-gray-400" />}
      {isActive && direction === 'asc' && <ArrowUp className="ml-2 h-4 w-4 text-blue-600" />}
      {isActive && direction === 'desc' && <ArrowDown className="ml-2 h-4 w-4 text-blue-600" />}
    </Button></TableHead>
  }

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>

  return <div className="space-y-6">
    <div className="flex items-center justify-between">
      <div><h1 className="text-2xl font-bold text-gray-900">User Management</h1><p className="text-gray-600">Manage system users and access permissions</p></div>
      <Button onClick={() => { setEditingUser(null); setDialogOpen(true) }} className="bg-blue-600 hover:bg-blue-700" disabled={isSaving}><Plus className="w-4 h-4 mr-2" />Add User</Button>
    </div>
    <UserDialog user={editingUser} roles={roles} organizations={organizations} open={dialogOpen} isSaving={isSaving} currentUserRoleLevel={userProfile?.roles?.role_level || 100} onOpenChange={setDialogOpen} onSave={handleAddUser} />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card><CardContent className="p-6"><div className="flex items-start justify-between"><div><p className="text-sm text-gray-600 mb-1">Total Users</p><p className="text-3xl font-bold text-gray-900">{stats.total}</p></div><div className="w-12 h-12 rounded-lg bg-blue-50 flex items-center justify-center"><Users className="w-6 h-6 text-blue-600" /></div></div></CardContent></Card>
      <Card><CardContent className="p-6"><div className="flex items-start justify-between"><div><p className="text-sm text-gray-600 mb-1">Active Users</p><p className="text-3xl font-bold text-green-600">{stats.active}</p></div><div className="w-12 h-12 rounded-lg bg-green-50 flex items-center justify-center"><Users className="w-6 h-6 text-green-600" /></div></div></CardContent></Card>
      <Card><CardContent className="p-6"><div className="flex items-start justify-between"><div><p className="text-sm text-gray-600 mb-1">Verified Users</p><p className="text-3xl font-bold text-purple-600">{stats.verified}</p></div><div className="w-12 h-12 rounded-lg bg-purple-50 flex items-center justify-center"><CheckCircle className="w-6 h-6 text-purple-600" /></div></div></CardContent></Card>
    </div>
    <Card><CardContent className="pt-6"><div className="flex items-center gap-2"><Search className="w-5 h-5 text-gray-400" /><Input placeholder="Search users by name or email..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-1" /></div></CardContent></Card>
    <Card><CardContent className="pt-6">{filteredUsers.length > 0 ? <div className="border rounded-lg overflow-hidden"><Table><TableHeader><TableRow>
      <SortableHeader field="name">User</SortableHeader>
      <SortableHeader field="role">Role</SortableHeader>
      <SortableHeader field="status">Status</SortableHeader>
      <SortableHeader field="organization">Department</SortableHeader>
      <SortableHeader field="date_joined">Join Date</SortableHeader>
      <SortableHeader field="last_login">Last Login</SortableHeader>
      <TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
      <TableBody>{filteredUsers.map((user) => <TableRow key={user.id} className="hover:bg-gray-50">
        <TableCell><div className="flex items-center gap-3"><Avatar className="w-10 h-10">
          {user.avatar_url && <AvatarImage 
            src={`${user.avatar_url.split('?')[0]}?v=${avatarRefresh[user.id] || Date.now()}`} 
            alt={user.full_name || 'User'} 
            key={`avatar-${user.id}-${avatarRefresh[user.id]}`}
          />}
          <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white text-xs font-medium">{getInitials(user.full_name)}</AvatarFallback>
        </Avatar><div className="min-w-0 flex-1"><div className="text-gray-900 truncate font-medium">{user.full_name || 'No Name'}</div><div className="text-sm text-gray-500 truncate">{user.email}</div></div></div></TableCell>
        <TableCell><Badge variant="outline" className={getRoleBadgeColor(user.role_code)}>{roleMap[user.role_code] || user.role_code}</Badge></TableCell>
        <TableCell><Badge variant="outline" className={user.is_active ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200'}>{user.is_active ? <><CheckCircle className="w-3 h-3 mr-1" />Active</> : <><XCircle className="w-3 h-3 mr-1" />Inactive</>}</Badge></TableCell>
        <TableCell><div className="min-w-0">{orgMap[user.organization_id] ? <><div className="text-gray-900 font-medium truncate">{orgMap[user.organization_id]}</div><div className="text-xs text-gray-500 truncate">{organizations.find(o => o.id === user.organization_id)?.org_type_code || ''}</div></> : <span className="text-gray-400 italic">No Department</span>}</div></TableCell>
        <TableCell><span className="text-gray-900">{new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span></TableCell>
        <TableCell><span className={user.last_login_at ? 'text-gray-900' : 'text-gray-400 italic'}>{formatRelativeTime(user.last_login_at)}</span></TableCell>
        <TableCell className="text-right"><div className="flex items-center justify-end gap-2"><Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditingUser(user); setDialogOpen(true) }}><Edit className="w-4 h-4 mr-1" />Edit</Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDeleteConfirmation({ show: true, userId: user.id }) }} className="text-red-600 hover:text-red-700 hover:bg-red-50"><Trash2 className="w-4 h-4 mr-1" />Delete</Button></div></TableCell>
      </TableRow>)}</TableBody>
    </Table></div> : <div className="text-center py-12"><Users className="w-12 h-12 text-gray-400 mx-auto mb-4" /><h3 className="text-lg font-medium text-gray-900 mb-2">No users found</h3><p className="text-gray-600">{searchQuery ? 'No users match your search' : 'Start by adding your first user'}</p></div>}</CardContent></Card>
    
    {deleteConfirmation.show && (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Delete User?</h2>
            <p className="text-gray-600 mb-6">Are you sure you want to delete this user? This action cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setDeleteConfirmation({ show: false, userId: null })} disabled={isSaving}>Cancel</Button>
              <Button variant="destructive" onClick={() => {
                if (deleteConfirmation.userId) {
                  handleDeleteUser(deleteConfirmation.userId)
                }
              }} disabled={isSaving}>
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )}
  </div>
}
