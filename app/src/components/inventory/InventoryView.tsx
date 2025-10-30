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
  BarChart3,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react'

interface InventoryItem {
  id: string
  quantity_on_hand: number
  quantity_allocated: number
  quantity_available: number
  reorder_point: number
  reorder_quantity: number
  average_cost: number | null
  total_value?: number | null
  computed_total_value: number
  computed_unit_cost: number
  cost_source: 'average' | 'base' | 'none'
  warehouse_location: string | null
  product_variants?: {
    variant_code: string
    variant_name: string
    base_cost?: number | null
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
  onViewChange?: (view: string) => void
}

export default function InventoryView({ userProfile, onViewChange }: InventoryViewProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [locationFilter, setLocationFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [locations, setLocations] = useState<any[]>([])
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  
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

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // New column, start with ascending
      setSortColumn(column)
      setSortDirection('asc')
    }
    setCurrentPage(1) // Reset to first page
  }

  const getSortedInventory = () => {
    if (!sortColumn) return inventory

    const sorted = [...inventory].sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortColumn) {
        case 'variant_code':
          aValue = a.product_variants?.variant_code || ''
          bValue = b.product_variants?.variant_code || ''
          break
        case 'product_name':
          aValue = a.product_variants?.products?.product_name || ''
          bValue = b.product_variants?.products?.product_name || ''
          break
        case 'location':
          aValue = a.organizations?.org_name || ''
          bValue = b.organizations?.org_name || ''
          break
        case 'on_hand':
          aValue = a.quantity_on_hand
          bValue = b.quantity_on_hand
          break
        case 'allocated':
          aValue = a.quantity_allocated
          bValue = b.quantity_allocated
          break
        case 'available':
          aValue = a.quantity_available
          bValue = b.quantity_available
          break
        case 'total_value':
          aValue = a.computed_total_value || 0
          bValue = b.computed_total_value || 0
          break
        default:
          return 0
      }

      // Handle string comparison
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue)
      }

      // Handle number comparison
      if (sortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
      }
    })

    return sorted
  }

  const renderSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="w-4 h-4 ml-1 opacity-40" />
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-4 h-4 ml-1" />
      : <ArrowDown className="w-4 h-4 ml-1" />
  }

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
            base_cost,
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
      
      // Transform the data to handle both array and object responses from Supabase
      // With !inner joins, the response format can vary
      const transformedData = (data || []).map((item: any) => {
        const rawVariant = Array.isArray(item.product_variants)
          ? item.product_variants[0]
          : item.product_variants

        const normalizedVariant = rawVariant
          ? {
              ...rawVariant,
              base_cost: rawVariant.base_cost !== null && rawVariant.base_cost !== undefined
                ? Number(rawVariant.base_cost)
                : null,
              products: Array.isArray(rawVariant.products)
                ? rawVariant.products[0]
                : rawVariant.products
            }
          : null

        const normalizedOrg = Array.isArray(item.organizations)
          ? item.organizations[0]
          : item.organizations

        const averageCost = item.average_cost !== null && item.average_cost !== undefined
          ? Number(item.average_cost)
          : null

        const baseCost = normalizedVariant?.base_cost ?? null

        const costSource: 'average' | 'base' | 'none' = averageCost !== null && !Number.isNaN(averageCost)
          ? 'average'
          : baseCost !== null && !Number.isNaN(baseCost)
            ? 'base'
            : 'none'

        const computedUnitCost = costSource === 'none' ? 0 : (costSource === 'average' ? averageCost! : baseCost!)
        const computedTotalValue = Number((Number(item.quantity_on_hand || 0) * computedUnitCost).toFixed(2))

        return {
          ...item,
          average_cost: averageCost,
          product_variants: normalizedVariant,
          organizations: normalizedOrg,
          computed_unit_cost: computedUnitCost,
          computed_total_value: computedTotalValue,
          cost_source: costSource
        }
      })
      
  setInventory(transformedData as InventoryItem[])
    } catch (error) {
      console.error('Error fetching inventory:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchLocations = async () => {
    try {
      const { data, error} = await supabase
        .from('organizations')
        .select('id, org_name, org_code')
        .in('org_type_code', ['WH', 'HQ'])
        .eq('is_active', true)
        .order('org_name')

      if (error) throw error
      setLocations(data || [])
    } catch (error) {
      console.error('Error fetching locations:', error)
    }
  }

  const formatCurrency = (value: number) => {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
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
  const totalValue = inventory.reduce((sum, item) => sum + (item.computed_total_value || 0), 0)
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
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => onViewChange?.('stock-adjustment')}>
            <Package className="w-4 h-4 mr-2" />
            Stock Adjustment
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
        <Card>
          <CardContent className="p-3 sm:p-4 lg:p-6">
            <div className="flex items-start justify-between mb-2 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-purple-50 flex items-center justify-center">
                <BarChart3 className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" />
              </div>
              <div className="flex items-center gap-1 text-xs sm:text-sm text-green-600">
                <TrendingUp className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">+8.1%</span>
              </div>
            </div>
            <p className="text-gray-600 text-xs sm:text-sm mb-1">Total Inventory Value</p>
            <p className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">RM {formatCurrency(totalValue)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4 lg:p-6">
            <div className="flex items-start justify-between mb-2 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-green-50 flex items-center justify-center">
                <Package className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" />
              </div>
            </div>
            <p className="text-gray-600 text-xs sm:text-sm mb-1">In Stock</p>
            <p className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">{inStockPercentage}%</p>
            <p className="text-xs text-gray-600 hidden sm:block">{inStockItems} of {inventory.length} items</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4 lg:p-6">
            <div className="flex items-start justify-between mb-2 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-orange-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600" />
              </div>
            </div>
            <p className="text-gray-600 text-xs sm:text-sm mb-1">Low Stock</p>
            <p className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">{lowStockItems}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 sm:p-4 lg:p-6">
            <div className="flex items-start justify-between mb-2 sm:mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-red-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-red-600" />
              </div>
            </div>
            <p className="text-gray-600 text-xs sm:text-sm mb-1">Out of Stock</p>
            <p className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">{outOfStockItems}</p>
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
                <TableHead 
                  className="cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('variant_code')}
                >
                  <div className="flex items-center">
                    Variant Code
                    {renderSortIcon('variant_code')}
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('product_name')}
                >
                  <div className="flex items-center">
                    Product Name
                    {renderSortIcon('product_name')}
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('location')}
                >
                  <div className="flex items-center">
                    Location
                    {renderSortIcon('location')}
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('on_hand')}
                >
                  <div className="flex items-center">
                    On Hand
                    {renderSortIcon('on_hand')}
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('allocated')}
                >
                  <div className="flex items-center">
                    Allocated
                    {renderSortIcon('allocated')}
                  </div>
                </TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('available')}
                >
                  <div className="flex items-center">
                    Available
                    {renderSortIcon('available')}
                  </div>
                </TableHead>
                <TableHead>Stock Level</TableHead>
                <TableHead 
                  className="cursor-pointer hover:bg-gray-100 select-none text-right"
                  onClick={() => handleSort('total_value')}
                >
                  <div className="flex items-center justify-end">
                    Total Value
                    {renderSortIcon('total_value')}
                  </div>
                </TableHead>
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
                getSortedInventory().map((item) => (
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
                        RM {formatCurrency(item.computed_total_value)}
                      </span>
                      {item.cost_source !== 'none' && (
                        <p className="text-sm text-gray-600">
                          @ RM {formatCurrency(item.computed_unit_cost)}{' '}
                          {item.cost_source === 'average' ? '(Avg cost)' : '(Base cost)'}
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