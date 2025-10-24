'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { 
  BarChart3,
  Search,
  Filter,
  Download,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Calendar
} from 'lucide-react'

interface StockMovement {
  id: string
  movement_type: string
  reference_type: string | null
  reference_no: string | null
  quantity_change: number
  quantity_before: number
  quantity_after: number
  unit_cost: number | null
  total_cost: number | null
  reason: string | null
  notes: string | null
  warehouse_location: string | null
  created_at: string
  product_variants?: {
    variant_code: string
    variant_name: string
    products?: {
      product_name: string
    } | null
  } | null
  organizations?: {
    org_name: string
    org_code: string
  } | null
  manufacturers?: {
    org_name: string
  } | null
  users?: {
    email: string
  } | null
}

interface StockMovementReportViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

export default function StockMovementReportView({ userProfile, onViewChange }: StockMovementReportViewProps) {
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [movementTypeFilter, setMovementTypeFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  
  const { isReady, supabase } = useSupabaseAuth()
  const itemsPerPage = 20

  useEffect(() => {
    if (isReady) {
      loadMovements()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, searchQuery, movementTypeFilter, dateFrom, dateTo, currentPage])

  const loadMovements = async () => {
    try {
      setLoading(true)
      let query = supabase
        .from('stock_movements')
        .select(`
          id,
          movement_type,
          reference_type,
          reference_no,
          quantity_change,
          quantity_before,
          quantity_after,
          unit_cost,
          total_cost,
          reason,
          notes,
          warehouse_location,
          created_at,
          product_variants!inner (
            variant_code,
            variant_name,
            products (
              product_name
            )
          ),
          to_organization_id:organizations!stock_movements_to_organization_id_fkey (
            org_name,
            org_code
          ),
          manufacturer_id:organizations!stock_movements_manufacturer_id_fkey (
            org_name
          ),
          created_by:users (
            email
          )
        `)
        .order('created_at', { ascending: false })
        .range((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage - 1)

      // Apply filters
      if (searchQuery) {
        query = query.or(`product_variants.products.product_name.ilike.%${searchQuery}%,product_variants.variant_name.ilike.%${searchQuery}%,reference_no.ilike.%${searchQuery}%`)
      }

      if (movementTypeFilter !== 'all') {
        query = query.eq('movement_type', movementTypeFilter)
      }

      if (dateFrom) {
        query = query.gte('created_at', `${dateFrom}T00:00:00`)
      }

      if (dateTo) {
        query = query.lte('created_at', `${dateTo}T23:59:59`)
      }

      const { data, error } = await query

      if (error) throw error
      
      // Transform the data to handle array relationships from Supabase
      const transformedData: StockMovement[] = (data || []).map((item: any) => ({
        ...item,
        product_variants: Array.isArray(item.product_variants) ? item.product_variants[0] : item.product_variants,
        organizations: Array.isArray(item.organizations) ? item.organizations[0] : item.organizations,
        manufacturers: Array.isArray(item.manufacturers) ? item.manufacturers[0] : item.manufacturers,
        users: Array.isArray(item.users) ? item.users[0] : item.users,
        // Handle nested products array
        ...(item.product_variants && Array.isArray(item.product_variants) && item.product_variants[0] && {
          product_variants: {
            ...item.product_variants[0],
            products: Array.isArray(item.product_variants[0].products) 
              ? item.product_variants[0].products[0] 
              : item.product_variants[0].products
          }
        })
      }))
      
      setMovements(transformedData)
    } catch (error: any) {
      console.error('Failed to load movements:', error)
    } finally {
      setLoading(false)
    }
  }

  const getMovementTypeBadge = (type: string) => {
    const configs: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      'addition': { label: 'Addition', variant: 'default' as const },
      'adjustment': { label: 'Adjustment', variant: 'secondary' as const },
      'transfer_out': { label: 'Transfer Out', variant: 'outline' as const },
      'transfer_in': { label: 'Transfer In', variant: 'default' as const },
      'allocation': { label: 'Allocated', variant: 'secondary' as const },
      'deallocation': { label: 'Deallocated', variant: 'outline' as const },
      'order_fulfillment': { label: 'Fulfilled', variant: 'destructive' as const },
      'order_cancelled': { label: 'Cancelled', variant: 'outline' as const }
    }

    const config = configs[type] || { label: type, variant: 'outline' as const }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-MY', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const exportToCSV = () => {
    const headers = ['Date', 'Type', 'Product', 'Variant', 'Location', 'Quantity Change', 'Before', 'After', 'Cost', 'Reference', 'Reason', 'User']
    const rows = movements.map(m => [
      formatDate(m.created_at),
      m.movement_type,
      m.product_variants?.products?.product_name || '',
      m.product_variants?.variant_name || '',
      m.organizations?.org_name || '',
      m.quantity_change,
      m.quantity_before,
      m.quantity_after,
      m.unit_cost || '',
      m.reference_no || '',
      m.reason || '',
      m.users?.email || ''
    ])

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stock-movements-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const totalIncrease = movements
    .filter(m => m.quantity_change > 0)
    .reduce((sum, m) => sum + m.quantity_change, 0)

  const totalDecrease = movements
    .filter(m => m.quantity_change < 0)
    .reduce((sum, m) => sum + Math.abs(m.quantity_change), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Stock Movement Reports</h1>
        <p className="text-gray-600 mt-1">Complete audit trail of all inventory movements</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Total Movements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600" />
              <span className="text-2xl font-bold">{movements.length}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">Current page records</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Stock Additions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              <span className="text-2xl font-bold text-green-600">+{totalIncrease}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">Units added</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-gray-600">Stock Reductions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-red-600" />
              <span className="text-2xl font-bold text-red-600">-{totalDecrease}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">Units removed</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* Search */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Product, variant, or reference..."
                  className="pl-10"
                />
              </div>
            </div>

            {/* Movement Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Movement Type
              </label>
              <Select value={movementTypeFilter} onValueChange={setMovementTypeFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="addition">Addition</SelectItem>
                  <SelectItem value="adjustment">Adjustment</SelectItem>
                  <SelectItem value="transfer_out">Transfer Out</SelectItem>
                  <SelectItem value="transfer_in">Transfer In</SelectItem>
                  <SelectItem value="allocation">Allocation</SelectItem>
                  <SelectItem value="deallocation">Deallocation</SelectItem>
                  <SelectItem value="order_fulfillment">Order Fulfillment</SelectItem>
                  <SelectItem value="order_cancelled">Order Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date From */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Date From
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Date To
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <Button 
              variant="outline" 
              onClick={() => {
                setSearchQuery('')
                setMovementTypeFilter('all')
                setDateFrom('')
                setDateTo('')
                setCurrentPage(1)
              }}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Clear Filters
            </Button>
            <Button variant="outline" onClick={exportToCSV} disabled={movements.length === 0}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Movements Table */}
      <Card>
        <CardHeader>
          <CardTitle>Movement History</CardTitle>
          <CardDescription>
            {loading ? 'Loading...' : `Showing ${movements.length} movements`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date/Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Before</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8">
                      Loading movements...
                    </TableCell>
                  </TableRow>
                ) : movements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-gray-500">
                      No movements found
                    </TableCell>
                  </TableRow>
                ) : (
                  movements.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell className="text-sm">
                        {formatDate(movement.created_at)}
                      </TableCell>
                      <TableCell>
                        {getMovementTypeBadge(movement.movement_type)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {movement.product_variants?.products?.product_name || 'N/A'}
                      </TableCell>
                      <TableCell>
                        <div>
                          <Badge variant="secondary" className="text-xs">
                            {movement.product_variants?.variant_code}
                          </Badge>
                          <p className="text-xs text-gray-600 mt-1">
                            {movement.product_variants?.variant_name}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {movement.organizations?.org_name || 'N/A'}
                        {movement.warehouse_location && (
                          <p className="text-xs text-gray-500">{movement.warehouse_location}</p>
                        )}
                      </TableCell>
                      <TableCell className={`text-right font-semibold ${
                        movement.quantity_change > 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {movement.quantity_change > 0 ? '+' : ''}{movement.quantity_change}
                      </TableCell>
                      <TableCell className="text-right text-gray-600">
                        {movement.quantity_before}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {movement.quantity_after}
                      </TableCell>
                      <TableCell className="text-right">
                        {movement.unit_cost ? (
                          <div>
                            <p className="text-sm">RM {movement.unit_cost.toFixed(2)}</p>
                            {movement.total_cost && (
                              <p className="text-xs text-gray-500">
                                Total: RM {movement.total_cost.toFixed(2)}
                              </p>
                            )}
                          </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {movement.reference_no ? (
                          <Badge variant="outline">{movement.reference_no}</Badge>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                        {movement.reference_type && (
                          <p className="text-xs text-gray-500 mt-1">{movement.reference_type}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm max-w-xs">
                        {movement.reason && (
                          <p className="text-gray-700 truncate" title={movement.reason}>
                            {movement.reason}
                          </p>
                        )}
                        {movement.manufacturers && (
                          <p className="text-xs text-gray-500 mt-1">
                            Mfg: {movement.manufacturers.org_name}
                          </p>
                        )}
                        {movement.users && (
                          <p className="text-xs text-gray-500 mt-1">
                            By: {movement.users.email.split('@')[0]}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-6">
            <p className="text-sm text-gray-600">
              Page {currentPage}
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
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={movements.length < itemsPerPage}
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
