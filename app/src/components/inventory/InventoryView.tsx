'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  Package, 
  Search, 
  Download, 
  AlertTriangle,
  TrendingUp,
  Warehouse,
  BarChart3
} from 'lucide-react'

interface InventoryItem {
  id: string
  quantity_on_hand: number
  quantity_allocated: number
  quantity_available: number
  reorder_point: number
  reorder_quantity: number
  average_cost: number | null
  total_value: number | null
  warehouse_location: string | null
  product_variants?: {
    variant_code: string
    variant_name: string
    products?: {
      product_name: string
      product_code: string
    }
  }
  organizations?: {
    org_name: string
    org_code: string
  }
}

interface InventoryViewProps {
  userProfile: any
}

export default function InventoryView({ userProfile }: InventoryViewProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [locationFilter, setLocationFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [locations, setLocations] = useState<any[]>([])
  
  const { isReady, supabase } = useSupabaseAuth()
  const itemsPerPage = 15

  useEffect(() => {
    if (isReady) {
      fetchInventory()
      fetchLocations()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, searchQuery, locationFilter, statusFilter, currentPage])

  const fetchInventory = async () => {
    if (!isReady) return

    setLoading(true)
    try {
      let query = supabase
        .from('product_inventory')
        .select(`
          id,
          quantity_on_hand,
          quantity_allocated,
          quantity_available,
          reorder_point,
          reorder_quantity,
          average_cost,
          total_value,
          warehouse_location,
          product_variants!inner (
            variant_code,
            variant_name,
            products!inner (
              product_name,
              product_code
            )
          ),
          organizations!inner (
            org_name,
            org_code
          )
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false })

      // Apply filters
      if (searchQuery) {
        query = query.or(`product_variants.variant_name.ilike.%${searchQuery}%,product_variants.products.product_name.ilike.%${searchQuery}%`)
      }

      if (locationFilter !== 'all') {
        query = query.eq('organization_id', locationFilter)
      }

      if (statusFilter === 'low_stock') {
        query = query.lt('quantity_available', 'reorder_point')
      } else if (statusFilter === 'out_of_stock') {
        query = query.eq('quantity_available', 0)
      } else if (statusFilter === 'in_stock') {
        query = query.gt('quantity_available', 0)
      }

      // Pagination
      const start = (currentPage - 1) * itemsPerPage
      const end = start + itemsPerPage - 1
      query = query.range(start, end)

      const { data, error } = await query

      if (error) throw error
      
      // Transform the data to match our interface
      const transformedData = (data || []).map((item: any) => ({
        ...item,
        product_variants: item.product_variants?.[0] || null,
        organizations: item.organizations?.[0] || null
      }))
      
      setInventory(transformedData)
    } catch (error) {
      console.error('Error fetching inventory:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_name, org_code')
        .in('org_type_code', ['WAREHOUSE', 'DIST', 'HQ'])
        .eq('is_active', true)
        .order('org_name')

      if (error) throw error
      setLocations(data || [])
    } catch (error) {
      console.error('Error fetching locations:', error)
    }
  }

  const getStockLevelBadge = (available: number, reorderPoint: number) => {
    if (available === 0) {
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Out of Stock</Badge>
    } else if (available <= reorderPoint * 0.5) {
      return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Critical</Badge>
    } else if (available <= reorderPoint) {
      return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">Low Stock</Badge>
    } else {
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Healthy</Badge>
    }
  }

  const getStockPercentage = (available: number, reorderPoint: number) => {
    if (reorderPoint === 0) return 100
    return Math.min((available / reorderPoint) * 100, 100)
  }

  // Calculate stats
  const totalValue = inventory.reduce((sum, item) => sum + (item.total_value || 0), 0)
  const inStockItems = inventory.filter(item => item.quantity_available > 0).length
  const lowStockItems = inventory.filter(item => item.quantity_available <= item.reorder_point && item.quantity_available > 0).length
  const outOfStockItems = inventory.filter(item => item.quantity_available === 0).length
  const inStockPercentage = inventory.length > 0 ? Math.round((inStockItems / inventory.length) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-gray-600">Real-time inventory tracking across all locations</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700">
            <Package className="w-4 h-4 mr-2" />
            Stock Adjustment
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-lg bg-purple-50 flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-purple-600" />
              </div>
              <div className="flex items-center gap-1 text-sm text-green-600">
                <TrendingUp className="w-4 h-4" />
                <span>+8.1%</span>
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-1">Total Inventory Value</p>
            <p className="text-2xl font-bold text-gray-900">RM {totalValue.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-lg bg-green-50 flex items-center justify-center">
                <Package className="w-6 h-6 text-green-600" />
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-1">In Stock</p>
            <p className="text-2xl font-bold text-gray-900">{inStockPercentage}%</p>
            <p className="text-xs text-gray-600">{inStockItems} of {inventory.length} items</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-orange-600" />
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-1">Low Stock</p>
            <p className="text-2xl font-bold text-gray-900">{lowStockItems}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-lg bg-red-50 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-1">Out of Stock</p>
            <p className="text-2xl font-bold text-gray-900">{outOfStockItems}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[300px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <Input
                  placeholder="Search by product name or variant..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Location" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.org_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="in_stock">In Stock</SelectItem>
                <SelectItem value="low_stock">Low Stock</SelectItem>
                <SelectItem value="out_of_stock">Out of Stock</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Inventory Table */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory Items</CardTitle>
          <CardDescription>
            {loading ? 'Loading...' : `${inventory.length} inventory items found`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variant Code</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>On Hand</TableHead>
                <TableHead>Allocated</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>Stock Level</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    Loading inventory...
                  </TableCell>
                </TableRow>
              ) : inventory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    No inventory items found
                  </TableCell>
                </TableRow>
              ) : (
                inventory.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-sm">
                      {item.product_variants?.variant_code || 'N/A'}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {item.product_variants?.products?.product_name || 'Unknown Product'}
                        </p>
                        <p className="text-sm text-gray-600">
                          {item.product_variants?.variant_name || 'No variant'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{item.organizations?.org_name || 'Unknown Location'}</p>
                        {item.warehouse_location && (
                          <p className="text-sm text-gray-600">{item.warehouse_location}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{item.quantity_on_hand}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-600">{item.quantity_allocated}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{item.quantity_available}</span>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        {getStockLevelBadge(item.quantity_available, item.reorder_point)}
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${
                              item.quantity_available === 0 ? 'bg-red-500' :
                              item.quantity_available <= item.reorder_point * 0.5 ? 'bg-red-500' :
                              item.quantity_available <= item.reorder_point ? 'bg-orange-500' : 'bg-green-500'
                            }`}
                            style={{ 
                              width: `${getStockPercentage(item.quantity_available, item.reorder_point)}%` 
                            }}
                          />
                        </div>
                        <p className="text-xs text-gray-600">
                          Reorder at: {item.reorder_point}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium">
                        RM {(item.total_value || 0).toLocaleString()}
                      </span>
                      {item.average_cost && (
                        <p className="text-sm text-gray-600">
                          @ RM {item.average_cost.toFixed(2)}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-gray-600 text-sm">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, inventory.length)} of {inventory.length} items
            </p>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                className="bg-blue-50 text-blue-600 border-blue-200"
              >
                {currentPage}
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={inventory.length < itemsPerPage}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}