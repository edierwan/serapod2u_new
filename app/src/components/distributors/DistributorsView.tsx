'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  Truck, 
  Search, 
  Filter, 
  Plus,
  Edit,
  Eye,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Package,
  Building2,
  TrendingUp,
  Star
} from 'lucide-react'

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

interface DistributorRelationship {
  id: string
  distributor_org_id: string
  manufacturer_org_id: string
  relationship_type: string
  commission_rate: number
  credit_limit: number
  payment_terms: string
  territory_coverage: string[]
  status: string
  contract_start_date: string
  contract_end_date: string | null
  performance_rating: number
  created_at: string
  updated_at: string
  distributor_org: {
    id: string
    org_code: string
    org_name: string
    org_name_short: string
    contact_person: string
    phone_number: string
    email: string
    city: string
    state: string
    is_active: boolean
    is_verified: boolean
  }
  manufacturer_org: {
    id: string
    org_code: string
    org_name: string
    org_name_short: string
  }
  total_orders?: number
  total_revenue?: number
  last_order_date?: string
}

interface DistributorsViewProps {
  userProfile: UserProfile
}

export default function DistributorsView({ userProfile }: DistributorsViewProps) {
  const [relationships, setRelationships] = useState<DistributorRelationship[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterTerritory, setFilterTerritory] = useState<string>('all')
  const { isReady, supabase } = useSupabaseAuth()

  useEffect(() => {
    if (isReady) {
      fetchDistributorRelationships()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady])

  const fetchDistributorRelationships = async () => {
    if (!isReady) return

    try {
      setLoading(true)
      
      // Build the query to get distributor relationships
      let query = supabase
        .from('distributor_relationships')
        .select(`
          *,
          distributor_org:organizations!distributor_org_id(
            id, org_code, org_name, org_name_short,
            contact_person, phone_number, email,
            city, state, is_active, is_verified
          ),
          manufacturer_org:organizations!manufacturer_org_id(
            id, org_code, org_name, org_name_short
          )
        `)

      // Apply access control based on user role and organization type
      if (userProfile.organizations.org_type_code === 'HQ' || userProfile.roles.role_level >= 90) {
        // HQ or super admin can see all relationships
      } else if (userProfile.organizations.org_type_code === 'MANU') {
        // Manufacturers can see their distributor relationships
        query = query.eq('manufacturer_org_id', userProfile.organization_id)
      } else if (userProfile.organizations.org_type_code === 'DIST') {
        // Distributors can see their own relationships
        query = query.eq('distributor_org_id', userProfile.organization_id)
      }

      const { data, error } = await query.order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching distributor relationships:', error)
        return
      }

      // Transform the data to match our interface
      const transformedData = data?.map(rel => ({
        ...rel,
        distributor_org: Array.isArray(rel.distributor_org) ? rel.distributor_org[0] : rel.distributor_org,
        manufacturer_org: Array.isArray(rel.manufacturer_org) ? rel.manufacturer_org[0] : rel.manufacturer_org,
        total_orders: Math.floor(Math.random() * 500) + 50, // Mock data
        total_revenue: Math.floor(Math.random() * 1000000) + 100000, // Mock data
        last_order_date: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString() // Mock data
      })) || []

      setRelationships(transformedData)
    } catch (error) {
      console.error('Error in fetchDistributorRelationships:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredRelationships = relationships.filter(rel => {
    const matchesSearch = 
      rel.distributor_org?.org_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rel.distributor_org?.org_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rel.distributor_org?.contact_person.toLowerCase().includes(searchTerm.toLowerCase()) ||
      rel.manufacturer_org?.org_name.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesStatus = filterStatus === 'all' || rel.status === filterStatus
    const matchesTerritory = filterTerritory === 'all' || 
      rel.territory_coverage.some(territory => territory.includes(filterTerritory))

    return matchesSearch && matchesStatus && matchesTerritory
  })

  const getStatusColor = (status: string) => {
    const colors = {
      'active': 'bg-green-100 text-green-700',
      'pending': 'bg-yellow-100 text-yellow-700',
      'suspended': 'bg-red-100 text-red-700',
      'terminated': 'bg-gray-100 text-gray-700'
    }
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-700'
  }

  const getPerformanceColor = (rating: number) => {
    if (rating >= 4.0) return 'text-green-600'
    if (rating >= 3.0) return 'text-yellow-600'
    return 'text-red-600'
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-MY', {
      style: 'currency',
      currency: 'MYR'
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-MY', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Distributors</h2>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-gray-200 rounded mb-4"></div>
                <div className="h-8 bg-gray-200 rounded mb-2"></div>
                <div className="h-4 bg-gray-200 rounded mb-4"></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="h-16 bg-gray-200 rounded"></div>
                  <div className="h-16 bg-gray-200 rounded"></div>
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
          <h2 className="text-2xl font-bold text-gray-900">Distributors</h2>
          <p className="text-gray-600">Manage distributor relationships and partnerships</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          Add Distributor
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Truck className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-600">Total Distributors</p>
                <p className="text-lg sm:text-xl font-bold">{relationships.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-50 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-600">Active</p>
                <p className="text-lg sm:text-xl font-bold">
                  {relationships.filter(r => r.status === 'active').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-yellow-50 flex items-center justify-center">
                <Package className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-600">Total Orders</p>
                <p className="text-lg sm:text-xl font-bold">
                  {relationships.reduce((sum, r) => sum + (r.total_orders || 0), 0)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                <Star className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-600">Avg. Rating</p>
                <p className="text-lg sm:text-xl font-bold">
                  {(relationships.reduce((sum, r) => sum + r.performance_rating, 0) / relationships.length || 0).toFixed(1)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search distributors..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full sm:w-48">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterTerritory} onValueChange={setFilterTerritory}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Territory" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Territories</SelectItem>
                <SelectItem value="KL">Kuala Lumpur</SelectItem>
                <SelectItem value="Selangor">Selangor</SelectItem>
                <SelectItem value="Penang">Penang</SelectItem>
                <SelectItem value="Johor">Johor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Distributors Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredRelationships.map((relationship) => (
          <Card key={relationship.id} className="hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Truck className="w-5 h-5 text-blue-600" />
                  <div>
                    <CardTitle className="text-lg">{relationship.distributor_org?.org_name}</CardTitle>
                    <CardDescription>{relationship.distributor_org?.org_code}</CardDescription>
                  </div>
                </div>
                <Badge className={getStatusColor(relationship.status)}>
                  {relationship.status}
                </Badge>
              </div>
              {/* Performance Rating */}
              <div className="flex items-center gap-2">
                <Star className={`w-4 h-4 ${getPerformanceColor(relationship.performance_rating)}`} />
                <span className={`text-sm font-medium ${getPerformanceColor(relationship.performance_rating)}`}>
                  {relationship.performance_rating.toFixed(1)}
                </span>
                <span className="text-xs text-gray-500">performance rating</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Contact Info */}
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <Building2 className="w-4 h-4" />
                  <span>{relationship.distributor_org?.contact_person}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <Phone className="w-4 h-4" />
                  <span>{relationship.distributor_org?.phone_number}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <Mail className="w-4 h-4" />
                  <span className="truncate">{relationship.distributor_org?.email}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <MapPin className="w-4 h-4" />
                  <span>{relationship.distributor_org?.city}, {relationship.distributor_org?.state}</span>
                </div>
              </div>

              {/* Territory Coverage */}
              <div className="pt-2 border-t">
                <p className="text-xs text-gray-500 mb-2">Territory Coverage:</p>
                <div className="flex flex-wrap gap-1">
                  {relationship.territory_coverage.map((territory, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {territory}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Business Metrics */}
              <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                <div>
                  <p className="text-xs text-gray-500">Total Orders</p>
                  <p className="text-lg font-semibold text-gray-900">{relationship.total_orders}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total Revenue</p>
                  <p className="text-lg font-semibold text-gray-900">
                    {formatCurrency(relationship.total_revenue || 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Commission Rate</p>
                  <p className="text-sm font-medium text-gray-900">{relationship.commission_rate}%</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Credit Limit</p>
                  <p className="text-sm font-medium text-gray-900">
                    {formatCurrency(relationship.credit_limit)}
                  </p>
                </div>
              </div>

              {/* Contract Info */}
              <div className="pt-2 border-t text-xs text-gray-500">
                <p>Contract: {formatDate(relationship.contract_start_date)} - {relationship.contract_end_date ? formatDate(relationship.contract_end_date) : 'Ongoing'}</p>
                <p>Last Order: {relationship.last_order_date ? formatDate(relationship.last_order_date) : 'N/A'}</p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" className="flex-1">
                  <Eye className="w-4 h-4 mr-2" />
                  View
                </Button>
                <Button variant="outline" size="sm" className="flex-1">
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredRelationships.length === 0 && !loading && (
        <Card>
          <CardContent className="p-12 text-center">
            <Truck className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No distributors found</h3>
            <p className="text-gray-600 mb-4">
              {searchTerm || filterStatus !== 'all' || filterTerritory !== 'all'
                ? 'Try adjusting your search criteria'
                : 'Get started by adding your first distributor relationship'
              }
            </p>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Distributor
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}