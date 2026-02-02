'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getStorageUrl } from '@/lib/utils'
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
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  AlertTriangle,
  X,
  Loader2,
  CheckCircle,
  XCircle,
  Info,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  default_warehouse_org_id: string | null
  contact_name: string
  contact_phone: string
  contact_email: string
  address: string
  address_line2: string
  city: string
  state_id: string | null
  district_id: string | null
  postal_code: string
  country_code: string
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
  states?: {
    state_name: string
  }
  children_count?: number
  users_count?: number
  products_count?: number
  distributors_count?: number
  shops_count?: number
  orders_count?: number
}

interface OrganizationsViewProps {
  userProfile: UserProfile
  onViewChange?: (view: string) => void
}

type SortField = 'org_name' | 'org_type_code' | 'contact_name' | 'state' | 'is_active'
type SortDirection = 'asc' | 'desc'

interface BlockingRecord {
  table_name: string
  display_name: string
  count: number
  description: string
  action: string
  priority: number
  auto_delete?: boolean
  can_force_delete?: boolean
  records?: Array<{
    id: string
    reference: string
    code?: string
    status?: string
    type?: string
    role?: string
  }> | null
}

interface DependencyCheckResult {
  success: boolean
  org_id?: string
  org_name?: string
  org_code?: string
  org_type?: string
  can_delete?: boolean
  has_blocking_records?: boolean
  blocking_records?: BlockingRecord[]
  deletion_order?: string
  error?: string
  error_code?: string
}

export default function OrganizationsView({ userProfile, onViewChange }: OrganizationsViewProps) {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'card' | 'list'>('list')
  const [sortField, setSortField] = useState<SortField>('org_name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [selectedShopForDistributors, setSelectedShopForDistributors] = useState<Organization | null>(null)
  const [selectedDistributorForShops, setSelectedDistributorForShops] = useState<Organization | null>(null)
  const [shopsWithDistributors, setShopsWithDistributors] = useState<Set<string>>(new Set())
  const [distributorsWithShops, setDistributorsWithShops] = useState<Set<string>>(new Set())
  const [shopLinkedDistributors, setShopLinkedDistributors] = useState<Map<string, string[]>>(new Map())
  const [distributorLinkedShops, setDistributorLinkedShops] = useState<Map<string, string[]>>(new Map())
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ show: boolean; orgId: string | null }>({ show: false, orgId: null })
  const [editingField, setEditingField] = useState<{ orgId: string; field: 'name' | 'phone' } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isSavingQuickEdit, setIsSavingQuickEdit] = useState(false)
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  // Delete dependencies modal state
  const [deleteDependenciesModal, setDeleteDependenciesModal] = useState<{
    show: boolean
    loading: boolean
    deleting: boolean
    orgId: string | null
    data: DependencyCheckResult | null
  }>({ show: false, loading: false, deleting: false, orgId: null, data: null })
  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      // Check if we need to refresh links after creating/editing organization
      const needsRefresh = sessionStorage.getItem('needsLinkRefresh')
      if (needsRefresh === 'true') {
        console.log('🔄 Refresh flag detected, will refresh link data...')

        sessionStorage.removeItem('needsLinkRefresh')

        // Longer delay to ensure DB writes are complete and indexes updated (1.5 seconds)
        setTimeout(() => {
          console.log('🔄 Refreshing organization and link data...')
          fetchOrganizations()
          checkShopDistributorLinks()
          checkDistributorShopLinks()
        }, 1500)
      } else {
        fetchOrganizations()
        checkShopDistributorLinks()
        checkDistributorShopLinks()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  const checkShopDistributorLinks = async () => {
    try {
      const { data, error } = await supabase
        .from('shop_distributors')
        .select(`
          shop_id,
          distributor_id,
          distributor:organizations!shop_distributors_distributor_id_fkey(org_name)
        `)
        .eq('is_active', true)

      if (error) throw error

      console.log('📊 Shop-Distributor links found:', data?.length || 0, data)

      const shopIds = new Set((data || []).map((sd: { shop_id: string }) => sd.shop_id))
      setShopsWithDistributors(shopIds)

      // Build map of shop_id -> [distributor names]
      const shopDistMap = new Map<string, string[]>()
        ; (data || []).forEach((sd: any) => {
          if (!shopDistMap.has(sd.shop_id)) {
            shopDistMap.set(sd.shop_id, [])
          }
          if (sd.distributor?.org_name) {
            shopDistMap.get(sd.shop_id)!.push(sd.distributor.org_name)
          }
        })
      setShopLinkedDistributors(shopDistMap)
      console.log('🏪 Shops with distributors:', Array.from(shopIds))
    } catch (error) {
      console.error('Error checking shop distributor links:', error)
    }
  }

  const checkDistributorShopLinks = async () => {
    try {
      const { data, error } = await supabase
        .from('shop_distributors')
        .select(`
          shop_id,
          distributor_id,
          shop:organizations!shop_distributors_shop_id_fkey(org_name)
        `)
        .eq('is_active', true)

      if (error) throw error

      console.log('📊 Distributor-Shop links found:', data?.length || 0, data)

      const distributorIds = new Set((data || []).map((sd: { distributor_id: string }) => sd.distributor_id))
      setDistributorsWithShops(distributorIds)

      // Build map of distributor_id -> [shop names]
      const distShopMap = new Map<string, string[]>()
        ; (data || []).forEach((sd: any) => {
          if (!distShopMap.has(sd.distributor_id)) {
            distShopMap.set(sd.distributor_id, [])
          }
          if (sd.shop?.org_name) {
            distShopMap.get(sd.distributor_id)!.push(sd.shop.org_name)
          }
        })
      setDistributorLinkedShops(distShopMap)
      console.log('🚚 Distributors with shops:', Array.from(distributorIds))
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
          parent_org:organizations!parent_org_id(org_name, org_code),
          payment_terms(term_name, deposit_percentage, balance_percentage),
          states(state_name)
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

      // Get all org IDs for batch stats query
      const orgIds = (data as any[])?.map((org: any) => org.id) || []

      console.log('🔍 Fetching stats for org IDs:', orgIds)

      // Use the database function to get all stats in ONE efficient query
      const { data: statsData, error: statsError } = await (supabase as any)
        .rpc('get_org_stats_batch', { p_org_ids: orgIds })

      if (statsError) {
        console.error('❌ Error fetching org stats:', statsError)
      } else {
        console.log('✅ Stats data received:', statsData)
      }

      // Create a map of stats by org_id for quick lookup
      const statsMap = new Map<string, any>()
        ; (statsData || []).forEach((stat: any) => {
          console.log(`📊 Org ${stat.org_type_code}:`, {
            org_id: stat.org_id,
            distributors_count: stat.distributors_count,
            shops_count: stat.shops_count,
            products_count: stat.products_count,
            users_count: stat.users_count,
            orders_count: stat.orders_count
          })
          statsMap.set(stat.org_id, stat)
        })

      console.log('📊 Organization Stats:', statsMap)

      // Transform the data to match our interface with stats
      const transformedData = (data as any[])?.map((org: any) => {
        const stats = statsMap.get(org.id) || {
          children_count: 0,
          users_count: 0,
          products_count: 0,
          distributors_count: 0,
          shops_count: 0,
          orders_count: 0
        }

        return {
          ...org,
          org_types: Array.isArray(org.org_types) ? org.org_types[0] : org.org_types,
          parent_org: Array.isArray(org.parent_org) ? org.parent_org[0] : org.parent_org,
          children_count: stats.children_count,
          users_count: stats.users_count,
          products_count: stats.products_count,
          distributors_count: stats.distributors_count,
          shops_count: stats.shops_count,
          orders_count: stats.orders_count
        }
      }) || []

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
  }).sort((a, b) => {
    let aVal: any = a[sortField]
    let bVal: any = b[sortField]

    // Handle null values
    if (aVal === null || aVal === undefined) return 1
    if (bVal === null || bVal === undefined) return -1

    // Handle different data types
    if (sortField === 'org_name' || sortField === 'contact_name') {
      aVal = (aVal || '').toLowerCase()
      bVal = (bVal || '').toLowerCase()
    } else if (sortField === 'state') {
      // Sort by state name
      aVal = (a.states?.state_name || '').toLowerCase()
      bVal = (b.states?.state_name || '').toLowerCase()
    } else if (sortField === 'org_type_code') {
      // Sort by type name instead of code
      aVal = a.org_types?.type_name || a.org_type_code
      bVal = b.org_types?.type_name || b.org_type_code
      aVal = aVal.toLowerCase()
      bVal = bVal.toLowerCase()
    } else if (sortField === 'is_active') {
      aVal = aVal ? 1 : 0
      bVal = bVal ? 1 : 0
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
    return 0
  })

  // Pagination calculations
  const totalOrganizations = filteredOrganizations.length
  const totalPages = Math.ceil(totalOrganizations / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedOrganizations = filteredOrganizations.slice(startIndex, endIndex)

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, filterType, filterStatus])

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

  const handleSetDefaultWarehouse = async (warehouse: Organization) => {
    try {
      // Find the parent HQ organization
      const parentHQ = organizations.find(o => o.id === warehouse.parent_org_id && o.org_type_code === 'HQ')

      if (!parentHQ) {
        toast({
          title: "Error",
          description: "Parent HQ not found. Only warehouses under an HQ can be set as default.",
          variant: "destructive"
        })
        return
      }

      // Confirm with user
      const isAlreadyDefault = parentHQ.default_warehouse_org_id === warehouse.id
      if (isAlreadyDefault) {
        toast({
          title: "Already Default",
          description: `${warehouse.org_name} is already the default warehouse for ${parentHQ.org_name}.`,
        })
        return
      }

      const confirmMsg = `Set ${warehouse.org_name} as the default warehouse for ${parentHQ.org_name}?\n\nAll new orders will be directed to this warehouse.`
      if (!confirm(confirmMsg)) return

      // Call the API to set default warehouse
      const response = await fetch('/api/organizations/set-default-warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hq_org_id: parentHQ.id,
          warehouse_org_id: warehouse.id
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to set default warehouse')
      }

      toast({
        title: "✓ Default Warehouse Updated",
        description: `${warehouse.org_name} is now the default warehouse for ${parentHQ.org_name}.`,
      })

      // Refresh organizations to show updated default status
      fetchOrganizations()

    } catch (error: any) {
      console.error('Error setting default warehouse:', error)
      toast({
        title: "Error",
        description: error.message || 'Failed to set default warehouse',
        variant: "destructive"
      })
    }
  }

  const handleDeleteOrganization = async (orgId: string) => {
    try {
      const org = organizations.find(o => o.id === orgId)
      const orgName = org?.org_name || 'Organization'
      const orgCode = org?.org_code || 'Unknown'

      // Call the hard delete function
      const { data, error } = await (supabase as any)
        .rpc('hard_delete_organization', { p_org_id: orgId })

      if (error) {
        console.error('Delete function error:', error)
        toast({
          title: "Delete Failed",
          description: error.message || 'Failed to delete organization',
          variant: "destructive"
        })
        return
      }

      // Check the response from the function
      if (!data || !data.success) {
        console.error('Delete failed:', data || 'No response data')

        // Handle null or missing data
        if (!data) {
          toast({
            title: "Delete Failed",
            description: 'No response received from server. There may be related records blocking deletion.',
            variant: "destructive"
          })
          return
        }

        // Show user-friendly error messages based on error code
        if (data.error_code === 'HAS_ORDERS') {
          toast({
            title: "Cannot Delete",
            description: `${orgName} has ${data.order_count} order(s). Organizations with orders cannot be deleted.`,
            variant: "destructive"
          })
        } else if (data.error_code === 'HAS_CHILDREN') {
          toast({
            title: "Cannot Delete",
            description: `${orgName} has ${data.child_count} active child organization(s). Delete them first.`,
            variant: "destructive"
          })
        } else if (data.error_code === 'ORG_NOT_FOUND') {
          toast({
            title: "Not Found",
            description: 'Organization not found. It may have already been deleted.',
            variant: "destructive"
          })
        } else if (data.error_code === 'FOREIGN_KEY_VIOLATION') {
          toast({
            title: "Cannot Delete",
            description: 'There are related records that must be deleted first. Use the delete button to see details.',
            variant: "destructive"
          })
        } else {
          toast({
            title: "Delete Failed",
            description: data.error || 'Unknown error occurred',
            variant: "destructive"
          })
        }
        return
      }

      // Success! Show detailed deletion summary
      const deletedRecords = data.deleted_related_records || {}
      const summary = []

      if (deletedRecords.users > 0) summary.push(`${deletedRecords.users} user(s)`)
      if (deletedRecords.shop_distributors > 0) summary.push(`${deletedRecords.shop_distributors} distributor link(s)`)
      if (deletedRecords.distributor_products > 0) summary.push(`${deletedRecords.distributor_products} product link(s)`)
      if (deletedRecords.inventory_records > 0) summary.push(`${deletedRecords.inventory_records} inventory record(s)`)

      const summaryText = summary.length > 0
        ? ` Also removed: ${summary.join(', ')}.`
        : ''

      toast({
        title: "✓ Successfully Deleted",
        description: `${orgName} (${orgCode}) has been permanently removed.${summaryText}`
      })

      setDeleteConfirmation({ show: false, orgId: null })

      // Refresh the organizations list
      fetchOrganizations()

      // Refresh the relationship text (Supplying To / Additional Distributors)
      checkShopDistributorLinks()
      checkDistributorShopLinks()
    } catch (error: any) {
      console.error('Error deleting organization:', error)
      toast({
        title: "Delete Failed",
        description: error.message || 'Unknown error',
        variant: "destructive"
      })
    }
  }

  const handleQuickEdit = (orgId: string, field: 'name' | 'phone', currentValue: string) => {
    setEditingField({ orgId, field })
    setEditValue(currentValue || '')
  }

  const handleCancelQuickEdit = () => {
    setEditingField(null)
    setEditValue('')
  }

  const handleSaveQuickEdit = async (org: Organization) => {
    if (!editingField) return

    try {
      setIsSavingQuickEdit(true)

      const updateData: Partial<Organization> = {
        updated_at: new Date().toISOString()
      }

      if (editingField.field === 'name') {
        updateData.contact_name = editValue.trim() || ''
      } else if (editingField.field === 'phone') {
        updateData.contact_phone = editValue.trim() || ''
      }

      const { error } = await (supabase as any)
        .from('organizations')
        .update(updateData)
        .eq('id', org.id)

      if (error) throw error

      toast({
        title: '✓ Updated',
        description: `${editingField.field === 'name' ? 'Contact name' : 'Contact phone'} updated successfully`
      })

      // Reset editing state
      setEditingField(null)
      setEditValue('')

      // Refresh organizations
      fetchOrganizations()
    } catch (error) {
      console.error('Error saving quick edit:', error)
      toast({
        title: '✕ Error',
        description: 'Failed to update. Please try again.',
        variant: 'destructive'
      })
    } finally {
      setIsSavingQuickEdit(false)
    }
  }

  // Check organization dependencies before deleting
  const checkDependencies = async (orgId: string) => {
    setDeleteDependenciesModal({ show: true, loading: true, deleting: false, orgId, data: null })

    try {
      const { data, error } = await (supabase as any)
        .rpc('check_organization_dependencies', { p_org_id: orgId })

      if (error) {
        console.error('Error checking dependencies:', error)
        setDeleteDependenciesModal(prev => ({
          ...prev,
          loading: false,
          data: {
            success: false,
            error: error.message || 'Failed to check dependencies'
          }
        }))
        return
      }

      setDeleteDependenciesModal(prev => ({
        ...prev,
        loading: false,
        data: data as DependencyCheckResult
      }))
    } catch (err: any) {
      console.error('Error checking dependencies:', err)
      setDeleteDependenciesModal(prev => ({
        ...prev,
        loading: false,
        data: {
          success: false,
          error: err.message || 'Failed to check dependencies'
        }
      }))
    }
  }

  const confirmDelete = (orgId: string) => {
    // Instead of simple confirm, check dependencies first
    checkDependencies(orgId)
  }

  // Proceed with deletion after user confirms
  const proceedWithDeletion = async () => {
    const orgId = deleteDependenciesModal.orgId
    if (!orgId) return

    setDeleteDependenciesModal(prev => ({ ...prev, deleting: true }))
    await handleDeleteOrganization(orgId)
    setDeleteDependenciesModal({ show: false, loading: false, deleting: false, orgId: null, data: null })
  }

  // Close the dependencies modal
  const closeDependenciesModal = () => {
    setDeleteDependenciesModal({ show: false, loading: false, deleting: false, orgId: null, data: null })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Organizations</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {filteredOrganizations.map((org) => (
            <Card key={org.id} className="hover:shadow-md transition-all duration-200 border border-gray-200 overflow-hidden">
              {/* Card Header with Status Badge */}
              <div className="relative px-5 pt-5 pb-4">
                {/* Status Badge - Top Right */}
                <div className="absolute top-3 right-3">
                  <Badge className={`${getStatusColor(org.is_active, org.is_verified)} text-xs font-medium`}>
                    {getStatusText(org.is_active, org.is_verified)}
                  </Badge>
                </div>

                {/* Logo and Type Badges Row */}
                <div className="flex items-start gap-4">
                  {/* Organization Logo - Fixed size container with contain */}
                  <div className="w-14 h-14 rounded-lg border border-gray-200 bg-white flex items-center justify-center overflow-hidden flex-shrink-0">
                    {org.logo_url ? (
                      <img
                        src={getStorageUrl(org.logo_url) || org.logo_url}
                        alt={`${org.org_name} logo`}
                        className="w-full h-full object-contain p-1"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100">
                        <span className="text-blue-600 font-semibold text-sm">
                          {getOrgInitials(org.org_name)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Type and Payment Badges */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Badge className={`${getOrgTypeColor(org.org_type_code)} text-xs`}>
                      {org.org_types?.type_name || org.org_type_code}
                    </Badge>
                    {(org.org_type_code === 'MFG' || org.org_type_code === 'DIST' || org.org_type_code === 'SHOP') &&
                      (org as any).payment_terms && (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                          💰 {(org as any).payment_terms.deposit_percentage}/{(org as any).payment_terms.balance_percentage} Split
                        </Badge>
                      )}
                  </div>
                </div>

                {/* Organization Name and Code */}
                <div className="mt-4">
                  <h3 className="font-semibold text-gray-900 text-base leading-tight line-clamp-1">
                    {org.org_name}
                  </h3>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {org.org_code}
                    {(org.org_type_code === 'MFG' || org.org_type_code === 'DIST' || org.org_type_code === 'SHOP') &&
                      (org as any).payment_terms && (
                        <span className="text-purple-600 ml-1.5">
                          • {(org as any).payment_terms.deposit_percentage}% / {(org as any).payment_terms.balance_percentage}% split
                        </span>
                      )}
                  </p>
                </div>
              </div>

              {/* Card Content */}
              <CardContent className="px-5 pb-5 pt-0 space-y-3">
                {/* Contact Info - Compact Grid */}
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  {/* Contact Name */}
                  <div className="flex items-center gap-2 text-sm">
                    <Users className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    {(org.org_type_code === 'SHOP' || org.org_type_code === 'DIST' || org.org_type_code === 'WH' || org.org_type_code === 'MFG') &&
                      editingField?.orgId === org.id && editingField?.field === 'name' ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-7 text-sm flex-1"
                          placeholder="Enter contact name"
                          disabled={isSavingQuickEdit}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveQuickEdit(org)
                            if (e.key === 'Escape') handleCancelQuickEdit()
                          }}
                        />
                        <Button size="sm" onClick={() => handleSaveQuickEdit(org)} disabled={isSavingQuickEdit} className="h-7 px-2 text-xs">Save</Button>
                        <Button size="sm" variant="ghost" onClick={handleCancelQuickEdit} disabled={isSavingQuickEdit} className="h-7 px-2 text-xs">Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <span className={`truncate ${!org.contact_name ? 'text-gray-400 italic' : 'text-gray-700'}`}>
                          {org.contact_name || 'Not updated'}
                        </span>
                        {(org.org_type_code === 'SHOP' || org.org_type_code === 'DIST' || org.org_type_code === 'WH' || org.org_type_code === 'MFG') && (
                          <button onClick={() => handleQuickEdit(org.id, 'name', org.contact_name)} className="text-xs text-blue-600 hover:text-blue-700 hover:underline flex-shrink-0">[Edit]</button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Contact Phone */}
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    {(org.org_type_code === 'SHOP' || org.org_type_code === 'DIST' || org.org_type_code === 'WH' || org.org_type_code === 'MFG') &&
                      editingField?.orgId === org.id && editingField?.field === 'phone' ? (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-7 text-sm flex-1"
                          placeholder="Enter contact phone"
                          disabled={isSavingQuickEdit}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveQuickEdit(org)
                            if (e.key === 'Escape') handleCancelQuickEdit()
                          }}
                        />
                        <Button size="sm" onClick={() => handleSaveQuickEdit(org)} disabled={isSavingQuickEdit} className="h-7 px-2 text-xs">Save</Button>
                        <Button size="sm" variant="ghost" onClick={handleCancelQuickEdit} disabled={isSavingQuickEdit} className="h-7 px-2 text-xs">Cancel</Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <span className={`truncate ${!org.contact_phone ? 'text-gray-400 italic' : 'text-gray-700'}`}>
                          {org.contact_phone || 'Not updated'}
                        </span>
                        {(org.org_type_code === 'SHOP' || org.org_type_code === 'DIST' || org.org_type_code === 'WH' || org.org_type_code === 'MFG') && (
                          <button onClick={() => handleQuickEdit(org.id, 'phone', org.contact_phone)} className="text-xs text-blue-600 hover:text-blue-700 hover:underline flex-shrink-0">[Edit]</button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Email */}
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className={`truncate ${!org.contact_email ? 'text-gray-400 italic' : 'text-gray-700'}`}>
                      {org.contact_email || 'Not updated'}
                    </span>
                  </div>

                  {/* State */}
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className={`truncate ${!org.states?.state_name ? 'text-gray-400 italic' : 'text-gray-700'}`}>
                      {org.states?.state_name || 'Not updated'}
                    </span>
                  </div>
                </div>

                {/* Linked Organizations */}
                {(
                  (org.parent_org && org.org_type_code === 'SHOP') ||
                  (org.org_type_code === 'SHOP' && shopLinkedDistributors.has(org.id)) ||
                  (org.org_type_code === 'DIST' && distributorLinkedShops.has(org.id))
                ) && (
                    <div className="text-xs text-gray-500 bg-blue-50 rounded-lg px-3 py-2">
                      {/* Shop's Parent Distributor */}
                      {org.parent_org && org.org_type_code === 'SHOP' && (
                        <p className="mb-1">
                          Ordering From: <span className="font-medium text-blue-600">{org.parent_org.org_name}</span>
                        </p>
                      )}

                      {/* Shop's Additional Distributors */}
                      {org.org_type_code === 'SHOP' && shopLinkedDistributors.has(org.id) && (
                        <p>
                          Additional Distributors: <span className="font-medium">
                            {shopLinkedDistributors.get(org.id)?.join(', ') || 'None'}
                          </span>
                        </p>
                      )}

                      {/* Distributor's Linked Shops */}
                      {org.org_type_code === 'DIST' && distributorLinkedShops.has(org.id) && (
                        <p>
                          Supplying To: <span className="font-medium text-green-600">
                            {distributorLinkedShops.get(org.id)?.join(', ') || 'None'}
                          </span>
                        </p>
                      )}
                    </div>
                  )}

                {/* Stats - Compact Design */}
                <div className="grid grid-cols-3 gap-1 py-3 bg-gray-50 rounded-lg">
                  {org.org_type_code === 'SHOP' ? (
                    <>
                      <div className="text-center px-2">
                        <div className="text-xl font-bold text-gray-900">{org.distributors_count || 0}</div>
                        <div className="text-xs text-gray-500">Distributors</div>
                      </div>
                      <div className="text-center px-2 border-x border-gray-200">
                        <div className="text-xl font-bold text-gray-900">{org.users_count || 0}</div>
                        <div className="text-xs text-gray-500">Users</div>
                      </div>
                      <div className="text-center px-2">
                        <div className="text-xl font-bold text-gray-900">{org.orders_count || 0}</div>
                        <div className="text-xs text-gray-500">Orders</div>
                      </div>
                    </>
                  ) : org.org_type_code === 'DIST' ? (
                    <>
                      <div className="text-center px-2">
                        <div className="text-xl font-bold text-gray-900">{org.shops_count || 0}</div>
                        <div className="text-xs text-gray-500">Shops</div>
                      </div>
                      <div className="text-center px-2 border-x border-gray-200">
                        <div className="text-xl font-bold text-gray-900">{org.users_count || 0}</div>
                        <div className="text-xs text-gray-500">Users</div>
                      </div>
                      <div className="text-center px-2">
                        <div className="text-xl font-bold text-gray-900">{org.orders_count || 0}</div>
                        <div className="text-xs text-gray-500">Orders</div>
                      </div>
                    </>
                  ) : org.org_type_code === 'WH' ? (
                    <>
                      <div className="text-center px-2" title="This warehouse automatically receives orders from its parent HQ">
                        <div className="text-sm font-bold">
                          {org.parent_org && organizations.find(o => o.id === org.parent_org_id)?.default_warehouse_org_id === org.id ? (
                            <span className="text-blue-600">Yes</span>
                          ) : (
                            <span className="text-gray-400">No</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">Default</div>
                      </div>
                      <div className="text-center px-2 border-x border-gray-200">
                        <div className="text-xl font-bold text-gray-900">{org.users_count || 0}</div>
                        <div className="text-xs text-gray-500">Users</div>
                      </div>
                      <div className="text-center px-2">
                        <div className="text-xl font-bold text-gray-900">{org.products_count || 0}</div>
                        <div className="text-xs text-gray-500">Products</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-center px-2">
                        <div className="text-xl font-bold text-gray-900">{org.children_count || 0}</div>
                        <div className="text-xs text-gray-500">Children</div>
                      </div>
                      <div className="text-center px-2 border-x border-gray-200">
                        <div className="text-xl font-bold text-gray-900">{org.users_count || 0}</div>
                        <div className="text-xs text-gray-500">Users</div>
                      </div>
                      <div className="text-center px-2">
                        <div className="text-xl font-bold text-gray-900">{org.products_count || 0}</div>
                        <div className="text-xs text-gray-500">Products</div>
                      </div>
                    </>
                  )}
                </div>

                {/* Actions - Clean Button Row */}
                <div className="flex gap-2 pt-3 border-t border-gray-100">
                  {org.org_type_code === 'SHOP' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-9 text-xs font-medium hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300"
                      onClick={() => {
                        setSelectedShopForDistributors(org)
                        checkShopDistributorLinks()
                      }}
                    >
                      <LinkIcon className={`w-3.5 h-3.5 mr-1.5 ${shopsWithDistributors.has(org.id) ? 'text-blue-600' : ''}`} />
                      Distributors
                    </Button>
                  )}
                  {org.org_type_code === 'DIST' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-9 text-xs font-medium hover:bg-green-50 hover:text-green-700 hover:border-green-300"
                      onClick={() => {
                        setSelectedDistributorForShops(org)
                        checkDistributorShopLinks()
                      }}
                    >
                      <LinkIcon className={`w-3.5 h-3.5 mr-1.5 ${distributorsWithShops.has(org.id) ? 'text-green-600' : ''}`} />
                      Shops
                    </Button>
                  )}
                  {org.org_type_code === 'WH' && org.parent_org_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      className={`flex-1 h-9 text-xs font-medium ${organizations.find(o => o.id === org.parent_org_id)?.default_warehouse_org_id === org.id
                        ? 'bg-blue-50 text-blue-700 border-blue-300'
                        : 'hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300'
                        }`}
                      onClick={() => handleSetDefaultWarehouse(org)}
                      disabled={organizations.find(o => o.id === org.parent_org_id)?.default_warehouse_org_id === org.id}
                    >
                      <Building2 className="w-3.5 h-3.5 mr-1.5" />
                      {organizations.find(o => o.id === org.parent_org_id)?.default_warehouse_org_id === org.id ? 'Default ✓' : 'Default'}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-9 text-xs font-medium hover:bg-gray-100"
                    onClick={() => handleEditOrganization(org)}
                  >
                    <Edit className="w-3.5 h-3.5 mr-1.5" />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-9 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700 border-red-200 hover:border-red-300"
                    onClick={() => confirmDelete(org.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
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
                  <TableHead className="w-[50px] text-xs">No</TableHead>
                  <TableHead>
                    <button
                      onClick={() => handleSort('org_name')}
                      className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium text-xs"
                    >
                      Organization
                      {sortField === 'org_name' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-30" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => handleSort('org_type_code')}
                      className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium text-xs"
                    >
                      Type
                      {sortField === 'org_type_code' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-30" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => handleSort('contact_name')}
                      className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium text-xs"
                    >
                      Contact
                      {sortField === 'contact_name' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-30" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => handleSort('state')}
                      className="flex items-center gap-1 hover:text-gray-900 transition-colors font-medium text-xs"
                    >
                      State
                      {sortField === 'state' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-30" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead className="text-right text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedOrganizations.map((org, index) => (
                  <TableRow key={org.id}>
                    <TableCell className="text-xs text-gray-500">
                      {startIndex + index + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {/* Removed Avatar */}
                        <div>
                          <div className="font-medium text-xs">{org.org_name}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${getOrgTypeColor(org.org_type_code)} text-[10px] px-1.5 py-0.5`}>
                        {org.org_types?.type_name || org.org_type_code}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">
                        <div className="font-medium">{org.contact_name || '-'}</div>
                        <div className="text-gray-500">{org.contact_phone || '-'}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">
                        <div>{org.states?.state_name || 'Not updated'}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {/* Manage Distributors button for SHOP organizations */}
                        {org.org_type_code === 'SHOP' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => {
                              setSelectedShopForDistributors(org)
                              checkShopDistributorLinks() // Refresh on open
                            }}
                            title="Manage Distributors"
                          >
                            <LinkIcon
                              className={`w-3.5 h-3.5 ${shopsWithDistributors.has(org.id) ? 'text-blue-600' : 'text-gray-400'}`}
                            />
                          </Button>
                        )}
                        {/* Manage Shops button for DIST organizations */}
                        {org.org_type_code === 'DIST' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => {
                              setSelectedDistributorForShops(org)
                              checkDistributorShopLinks() // Refresh on open
                            }}
                            title="Manage Shops"
                          >
                            <LinkIcon
                              className={`w-3.5 h-3.5 ${distributorsWithShops.has(org.id) ? 'text-blue-600' : 'text-gray-400'}`}
                            />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => handleEditOrganization(org)}
                          title="Edit"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                          onClick={() => confirmDelete(org.id)}
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination Controls */}
            {totalOrganizations > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
                <div className="flex items-center gap-4">
                  <span className="text-xs text-gray-700">
                    Showing {startIndex + 1} to {Math.min(endIndex, totalOrganizations)} of {totalOrganizations} organizations
                  </span>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">Rows:</span>
                    <Select
                      value={itemsPerPage.toString()}
                      onValueChange={(value) => {
                        setItemsPerPage(Number(value))
                        setCurrentPage(1)
                      }}
                    >
                      <SelectTrigger className="h-7 w-[70px] text-xs bg-white">
                        <SelectValue placeholder="10" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="30">30</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="200">200</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-xs text-gray-700">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
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

      {/* Delete Dependencies Modal */}
      <Dialog open={deleteDependenciesModal.show} onOpenChange={(open) => !open && closeDependenciesModal()}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {deleteDependenciesModal.loading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                  Checking Dependencies...
                </>
              ) : deleteDependenciesModal.data?.can_delete ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  Ready to Delete
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Cannot Delete Organization
                </>
              )}
            </DialogTitle>
            {deleteDependenciesModal.data && (
              <DialogDescription>
                <span className="font-semibold">{deleteDependenciesModal.data.org_name}</span>
                {' '}({deleteDependenciesModal.data.org_code}) - {deleteDependenciesModal.data.org_type}
              </DialogDescription>
            )}
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            {deleteDependenciesModal.loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : deleteDependenciesModal.data?.error ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-red-700">
                  <XCircle className="h-5 w-5" />
                  <span className="font-medium">Error</span>
                </div>
                <p className="text-red-600 mt-2">{deleteDependenciesModal.data.error}</p>
              </div>
            ) : deleteDependenciesModal.data?.can_delete ? (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-green-700">
                    This organization has no blocking dependencies and can be safely deleted.
                  </p>
                </div>
                {deleteDependenciesModal.data.blocking_records && deleteDependenciesModal.data.blocking_records.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600">The following will be automatically removed:</p>
                    {deleteDependenciesModal.data.blocking_records
                      .filter(r => r.auto_delete)
                      .map((record, index) => (
                        <div key={index} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-700">{record.display_name}</span>
                            <Badge variant="secondary">{record.count} record(s)</Badge>
                          </div>
                          <p className="text-sm text-gray-500 mt-1">{record.action}</p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ) : deleteDependenciesModal.data?.has_blocking_records ? (
              <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <p className="text-amber-700">
                    This organization cannot be deleted because it has related records that must be removed first.
                    Please delete the following records in order:
                  </p>
                </div>

                <div className="space-y-3">
                  {deleteDependenciesModal.data.blocking_records
                    ?.filter(r => !r.auto_delete)
                    .sort((a, b) => a.priority - b.priority)
                    .map((record, index) => (
                      <div key={index} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-1 rounded">
                              Step {index + 1}
                            </span>
                            <span className="font-semibold text-gray-800">{record.display_name}</span>
                          </div>
                          <Badge variant={record.count > 0 ? "destructive" : "secondary"}>
                            {record.count} record(s)
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">{record.description}</p>
                        <div className="flex items-start gap-2 bg-blue-50 rounded p-2">
                          <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-blue-700">{record.action}</p>
                        </div>

                        {/* Show sample records if available */}
                        {record.records && record.records.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <p className="text-xs text-gray-500 mb-2">Sample records:</p>
                            <div className="space-y-1">
                              {record.records.slice(0, 5).map((r, i) => (
                                <div key={i} className="text-xs bg-gray-50 rounded px-2 py-1 flex items-center gap-2">
                                  <span className="font-mono text-gray-600">{r.reference}</span>
                                  {r.code && <span className="text-gray-400">({r.code})</span>}
                                  {r.status && (
                                    <Badge variant="outline" className="text-xs px-1 py-0">
                                      {r.status}
                                    </Badge>
                                  )}
                                </div>
                              ))}
                              {record.count > 5 && (
                                <p className="text-xs text-gray-400 italic">
                                  ... and {record.count - 5} more
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                </div>

                {/* Show auto-delete items */}
                {deleteDependenciesModal.data.blocking_records?.filter(r => r.auto_delete).length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <p className="text-sm text-gray-500 mb-2">These will be automatically removed when deleting:</p>
                    {deleteDependenciesModal.data.blocking_records
                      ?.filter(r => r.auto_delete)
                      .map((record, index) => (
                        <div key={index} className="flex items-center justify-between py-1">
                          <span className="text-sm text-gray-600">{record.display_name}</span>
                          <Badge variant="secondary">{record.count}</Badge>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ) : null}
          </ScrollArea>

          <DialogFooter className="mt-4 pt-4 border-t">
            <Button variant="outline" onClick={closeDependenciesModal} disabled={deleteDependenciesModal.deleting}>
              Cancel
            </Button>
            {deleteDependenciesModal.data?.can_delete && (
              <Button
                variant="destructive"
                onClick={proceedWithDeletion}
                disabled={deleteDependenciesModal.deleting}
              >
                {deleteDependenciesModal.deleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Organization
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}