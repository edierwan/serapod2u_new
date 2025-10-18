'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  Building2, 
  Search, 
  Filter, 
  Plus,
  Edit,
  Eye,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Users,
  Package,
  LayoutGrid,
  List,
  Link as LinkIcon,
  Trash2
} from 'lucide-react'
import ShopDistributorsManager from '@/components/shops/ShopDistributorsManager'
import DistributorShopsManager from '@/components/distributors/DistributorShopsManager'

interface UserProfile {
  id: string
  email: string
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

interface Organization {
  id: string
  org_code: string
  org_name: string
  org_name_short: string
  org_type_code: string
  parent_org_id: string | null
  contact_name: string
  contact_phone: string
  contact_email: string
  address: string
  city: string
  state: string
  postal_code: string
  country: string
  is_active: boolean
  is_verified: boolean
  created_at: string
  updated_at: string
  logo_url: string | null
  org_types: {
    type_name: string
    description: string
  }
  parent_org?: {
    org_name: string
    org_code: string
  }
  children_count?: number
  users_count?: number
  products_count?: number
}

interface OrganizationsViewProps {
  userProfile: UserProfile
  onViewChange?: (view: string) => void
}

export default function OrganizationsView({ userProfile, onViewChange }: OrganizationsViewProps) {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card')
  const [selectedShopForDistributors, setSelectedShopForDistributors] = useState<Organization | null>(null)
  const [selectedDistributorForShops, setSelectedDistributorForShops] = useState<Organization | null>(null)
  const [shopsWithDistributors, setShopsWithDistributors] = useState<Set<string>>(new Set())
  const [distributorsWithShops, setDistributorsWithShops] = useState<Set<string>>(new Set())
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ show: boolean; orgId: string | null }>({ show: false, orgId: null })
  const { isReady, supabase } = useSupabaseAuth()

  useEffect(() => {
    if (isReady) {
      fetchOrganizations()
      checkShopDistributorLinks()
      checkDistributorShopLinks()
    }
  }, [isReady])

  const checkShopDistributorLinks = async () => {
    try {
      const { data, error } = await supabase
        .from('shop_distributors')
        .select('shop_id')
        .eq('is_active', true)

      if (error) throw error
      
      const shopIds = new Set((data || []).map(sd => sd.shop_id))
      setShopsWithDistributors(shopIds)
    } catch (error) {
      console.error('Error checking shop distributor links:', error)
    }
  }

  const checkDistributorShopLinks = async () => {
    try {
      const { data, error } = await supabase
        .from('shop_distributors')
        .select('distributor_id')
        .eq('is_active', true)

      if (error) throw error
      
      const distributorIds = new Set((data || []).map(sd => sd.distributor_id))
      setDistributorsWithShops(distributorIds)
    } catch (error) {
      console.error('Error checking distributor shop links:', error)
    }
  }

  const fetchOrganizations = async () => {
    if (!isReady) return

    try {
      setLoading(true)
      
      // Build the query based on user role and organization
      let query = supabase
        .from('organizations')
        .select(`
          *,
          org_types:organization_types(type_name, type_description),
          parent_org:organizations!parent_org_id(org_name, org_code)
        `)
        .eq('is_active', true)  // Only fetch active organizations
      
      // Apply access control based on user role
      // Super admin (role_level 1-50) can see all organizations
      // Others see their org and its children
      if (userProfile.roles.role_level > 50) {
        // Non-super admin: see own org and children
        query = query.or(`id.eq.${userProfile.organization_id},parent_org_id.eq.${userProfile.organization_id}`)
      }
      // If role_level <= 50 (Super Admin), no filter applied - sees all

      const { data, error } = await query.order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching organizations:', error)
        return
      }

      // Transform the data to match our interface
      const transformedData = data?.map(org => ({
        ...org,
        org_types: Array.isArray(org.org_types) ? org.org_types[0] : org.org_types,
        parent_org: Array.isArray(org.parent_org) ? org.parent_org[0] : org.parent_org,
        children_count: 0, // Would be calculated in a real scenario
        users_count: 0,    // Would be calculated in a real scenario  
        products_count: 0  // Would be calculated in a real scenario
      })) || []

      setOrganizations(transformedData)
    } catch (error) {
      console.error('Error in fetchOrganizations:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredOrganizations = organizations.filter(org => {
    const matchesSearch = 
      org.org_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      org.org_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (org.contact_name && org.contact_name.toLowerCase().includes(searchTerm.toLowerCase()))
    
    const matchesType = filterType === 'all' || org.org_type_code === filterType
    const matchesStatus = 
      filterStatus === 'all' || 
      (filterStatus === 'active' && org.is_active) ||
      (filterStatus === 'inactive' && !org.is_active)

    return matchesSearch && matchesType && matchesStatus
  })

  const getOrgTypeColor = (typeCode: string) => {
    const colors = {
      'HQ': 'bg-purple-100 text-purple-700',
      'MFG': 'bg-blue-100 text-blue-700',
      'DIST': 'bg-green-100 text-green-700',
      'WH': 'bg-orange-100 text-orange-700',
      'SHOP': 'bg-pink-100 text-pink-700'
    }
    return colors[typeCode as keyof typeof colors] || 'bg-gray-100 text-gray-700'
  }

  const getStatusColor = (isActive: boolean, isVerified: boolean) => {
    if (!isActive) return 'bg-red-100 text-red-700'
    // Active organizations show green (verified status is secondary)
    return 'bg-green-100 text-green-700'
  }

  const getStatusText = (isActive: boolean, isVerified: boolean) => {
    if (!isActive) return 'Inactive'
    // Organizations that are active are considered Active (verified status is secondary)
    return 'Active'
  }

  const getOrgInitials = (name: string) => {
    if (!name) return 'ORG'
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const handleEditOrganization = (org: Organization) => {
    // Store selected org for parent to handle
    sessionStorage.setItem('selectedOrgId', org.id)
    sessionStorage.setItem('selectedOrgType', org.org_type_code)
    
    // Only HQ goes to Settings
    if (org.org_type_code === 'HQ') {
      if (onViewChange) {
        onViewChange('edit-organization-hq')
      }
    } else {
      // Other org types go to dedicated edit page
      if (onViewChange) {
        onViewChange('edit-organization')
      }
    }
  }

  const handleViewOrganization = (orgId: string) => {
    sessionStorage.setItem('selectedOrgId', orgId)
    if (onViewChange) {
      onViewChange('view-organization')
    }
  }

  const handleDeleteOrganization = async (orgId: string) => {
    try {
      // Check if organization has children
      const { data: children, error: childrenError } = await supabase
        .from('organizations')
        .select('id')
        .eq('parent_org_id', orgId)
        .eq('is_active', true)

      if (childrenError) throw childrenError

      if (children && children.length > 0) {
        alert(`Cannot delete this organization. It has ${children.length} child organization(s). Please reassign or delete them first.`)
        return
      }

      // Check if organization has users
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id')
        .eq('organization_id', orgId)
        .eq('is_active', true)

      if (usersError) throw usersError

      if (users && users.length > 0) {
        alert(`Cannot delete this organization. It has ${users.length} active user(s). Please reassign or deactivate them first.`)
        return
      }

      // Soft delete by setting is_active to false
      const { error: deleteError } = await supabase
        .from('organizations')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', orgId)

      if (deleteError) throw deleteError

      alert('Organization deleted successfully!')
      setDeleteConfirmation({ show: false, orgId: null })
      fetchOrganizations()
    } catch (error: any) {
      console.error('Error deleting organization:', error)
      alert(`Failed to delete organization: ${error.message}`)
    }
  }

  const confirmDelete = (orgId: string) => {
    const org = organizations.find(o => o.id === orgId)
    if (window.confirm(`Are you sure you want to delete "${org?.org_name}"? This action cannot be undone.`)) {
      handleDeleteOrganization(orgId)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Organizations</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-gray-200 rounded mb-4"></div>
                <div className="h-8 bg-gray-200 rounded mb-2"></div>
                <div className="h-4 bg-gray-200 rounded mb-4"></div>
                <div className="flex gap-2">
                  <div className="h-6 bg-gray-200 rounded flex-1"></div>
                  <div className="h-6 bg-gray-200 rounded w-16"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Organizations</h2>
          <p className="text-gray-600">Manage your supply chain network</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => onViewChange?.('add-organization')}>
          <Plus className="w-4 h-4 mr-2" />
          Add Organization
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search organizations..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full sm:w-48">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="HQ">Headquarters</SelectItem>
                <SelectItem value="MFG">Manufacturer</SelectItem>
                <SelectItem value="DIST">Distributor</SelectItem>
                <SelectItem value="WH">Warehouse</SelectItem>
                <SelectItem value="SHOP">Shop</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button
                variant={viewMode === 'card' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('card')}
                className={viewMode === 'card' ? 'bg-blue-600 hover:bg-blue-700' : ''}
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('list')}
                className={viewMode === 'list' ? 'bg-blue-600 hover:bg-blue-700' : ''}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Organizations Grid/List */}
      {viewMode === 'card' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredOrganizations.map((org) => (
            <Card key={org.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {/* Organization Logo/Avatar */}
                    <Avatar className="w-12 h-12 rounded-lg">
                      <AvatarImage 
                        src={org.logo_url || undefined} 
                        alt={`${org.org_name} logo`}
                        className="object-cover"
                      />
                      <AvatarFallback className="rounded-lg bg-blue-100 text-blue-600 font-semibold">
                        {getOrgInitials(org.org_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <Badge className={getOrgTypeColor(org.org_type_code)}>
                        {org.org_types?.type_name || org.org_type_code}
                      </Badge>
                    </div>
                  </div>
                  <Badge className={getStatusColor(org.is_active, org.is_verified)}>
                    {getStatusText(org.is_active, org.is_verified)}
                  </Badge>
                </div>
                <div>
                  <CardTitle className="text-lg">{org.org_name}</CardTitle>
                  <CardDescription>{org.org_code}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Contact Info */}
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Users className="w-4 h-4" />
                    <span className={!org.contact_name ? 'text-gray-400 italic' : ''}>
                      {org.contact_name || 'Not updated'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <Phone className="w-4 h-4" />
                    <span className={!org.contact_phone ? 'text-gray-400 italic' : ''}>
                      {org.contact_phone || 'Not updated'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail className="w-4 h-4" />
                    <span className={!org.contact_email ? 'text-gray-400 italic truncate' : 'truncate'}>
                      {org.contact_email || 'Not updated'}
                    </span>
                  </div>
                  <div className="flex items-start gap-2 text-gray-600">
                    <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span className={!(org.city || org.state) ? 'text-gray-400 italic text-xs' : 'text-xs'}>
                      {[org.city, org.state].filter(Boolean).join(', ') || 'Not updated'}
                    </span>
                  </div>
                </div>

                {/* Parent Organization */}
                {org.parent_org && org.org_type_code !== 'HQ' && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-gray-500">
                      Linked to: <span className="font-medium">{org.parent_org.org_name}</span>
                    </p>
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                  <div className="text-center">
                    <div className="text-lg font-semibold text-gray-900">{org.children_count || 0}</div>
                    <div className="text-xs text-gray-500">Children</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-gray-900">{org.users_count || 0}</div>
                    <div className="text-xs text-gray-500">Users</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-gray-900">{org.products_count || 0}</div>
                    <div className="text-xs text-gray-500">Products</div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  {org.org_type_code === 'SHOP' && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => {
                        setSelectedShopForDistributors(org)
                        checkShopDistributorLinks() // Refresh on open
                      }}
                    >
                      <LinkIcon 
                        className={`w-4 h-4 mr-2 ${shopsWithDistributors.has(org.id) ? 'text-blue-600' : 'text-gray-400'}`} 
                      />
                      Distributors
                    </Button>
                  )}
                  {org.org_type_code === 'DIST' && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="flex-1"
                      onClick={() => {
                        setSelectedDistributorForShops(org)
                        checkDistributorShopLinks() // Refresh on open
                      }}
                    >
                      <LinkIcon 
                        className={`w-4 h-4 mr-2 ${distributorsWithShops.has(org.id) ? 'text-blue-600' : 'text-gray-400'}`} 
                      />
                      Shops
                    </Button>
                  )}
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1"
                    onClick={() => handleEditOrganization(org)}
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1 text-red-600 hover:text-red-700 border-red-300"
                    onClick={() => confirmDelete(org.id)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Organizations List</CardTitle>
            <CardDescription>
              {filteredOrganizations.length} organization{filteredOrganizations.length !== 1 ? 's' : ''} found
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Linked To</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrganizations.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {/* Organization Logo/Avatar */}
                        <Avatar className="w-10 h-10 rounded-lg flex-shrink-0">
                          <AvatarImage 
                            src={org.logo_url || undefined} 
                            alt={`${org.org_name} logo`}
                            className="object-cover"
                          />
                          <AvatarFallback className="rounded-lg bg-blue-100 text-blue-600 text-sm font-semibold">
                            {getOrgInitials(org.org_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{org.org_name}</div>
                          <div className="text-sm text-gray-500">{org.org_code}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getOrgTypeColor(org.org_type_code)}>
                        {org.org_types?.type_name || org.org_type_code}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div className="font-medium">{org.contact_name || '-'}</div>
                        <div className="text-gray-500">{org.contact_phone || '-'}</div>
                        <div className="text-gray-500 truncate max-w-[200px]">{org.contact_email || '-'}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>{org.city}</div>
                        <div className="text-gray-500">{org.state}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {org.parent_org && org.org_type_code !== 'HQ' ? (
                        <div className="text-sm">
                          <div className="font-medium">{org.parent_org.org_name}</div>
                          <div className="text-gray-500">{org.parent_org.org_code}</div>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">
                          {org.org_type_code === 'HQ' ? 'Root Level' : '-'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(org.is_active, org.is_verified)}>
                        {getStatusText(org.is_active, org.is_verified)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {/* Manage Distributors button for SHOP organizations */}
                        {org.org_type_code === 'SHOP' && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 w-8 p-0"
                            onClick={() => {
                              setSelectedShopForDistributors(org)
                              checkShopDistributorLinks() // Refresh on open
                            }}
                            title="Manage Distributors"
                          >
                            <LinkIcon 
                              className={`w-4 h-4 ${shopsWithDistributors.has(org.id) ? 'text-blue-600' : 'text-gray-400'}`} 
                            />
                          </Button>
                        )}
                        {/* Manage Shops button for DIST organizations */}
                        {org.org_type_code === 'DIST' && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-8 w-8 p-0"
                            onClick={() => {
                              setSelectedDistributorForShops(org)
                              checkDistributorShopLinks() // Refresh on open
                            }}
                            title="Manage Shops"
                          >
                            <LinkIcon 
                              className={`w-4 h-4 ${distributorsWithShops.has(org.id) ? 'text-blue-600' : 'text-gray-400'}`} 
                            />
                          </Button>
                        )}
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0"
                          onClick={() => handleEditOrganization(org)}
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                          onClick={() => confirmDelete(org.id)}
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {filteredOrganizations.length === 0 && !loading && (
        <Card>
          <CardContent className="p-12 text-center">
            <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No organizations found</h3>
            <p className="text-gray-600 mb-4">
              {searchTerm || filterType !== 'all' || filterStatus !== 'all'
                ? 'Try adjusting your search criteria'
                : 'Get started by adding your first organization'
              }
            </p>
            <Button onClick={() => onViewChange?.('add-organization')}>
              <Plus className="w-4 h-4 mr-2" />
              Add Organization
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Shop Distributors Manager Modal */}
      {selectedShopForDistributors && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Manage Distributors</h2>
                <p className="text-gray-600">
                  {selectedShopForDistributors.org_name} ({selectedShopForDistributors.org_code})
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedShopForDistributors(null)
                  checkShopDistributorLinks() // Refresh links when modal closes
                }}
              >
                ✕ Close
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <ShopDistributorsManager
                shopId={selectedShopForDistributors.id}
                shopName={selectedShopForDistributors.org_name}
              />
            </div>
          </div>
        </div>
      )}

      {/* Distributor Shops Manager Modal */}
      {selectedDistributorForShops && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Manage Shops</h2>
                <p className="text-gray-600">
                  {selectedDistributorForShops.org_name} ({selectedDistributorForShops.org_code})
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectedDistributorForShops(null)
                  checkDistributorShopLinks() // Refresh links when modal closes
                }}
              >
                ✕ Close
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-6">
              <DistributorShopsManager
                distributorId={selectedDistributorForShops.id}
                distributorName={selectedDistributorForShops.org_name}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}