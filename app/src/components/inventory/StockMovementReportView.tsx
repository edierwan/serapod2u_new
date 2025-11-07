'use client'

import { useState, useEffect, useMemo } from 'react'
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
  Calendar,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react'

interface StockMovement {
  id: string
  movement_type: string
  reference_type: string | null
  reference_id: string | null
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
  distributor_order_no?: string | null
  variant_code?: string | null
  variant_name?: string | null
  product_name?: string | null
  organization_name?: string | null
  organization_code?: string | null
  manufacturer_name?: string | null
  created_by_email?: string | null
  product_variants?: {
    variant_code: string
    variant_name: string
    base_cost?: number | null
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
  const [sortColumn, setSortColumn] = useState<string | null>('created_at')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  
  const { isReady, supabase } = useSupabaseAuth()
  const itemsPerPage = 20

  const numberFormatter = useMemo(() => new Intl.NumberFormat('en-MY'), [])
  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }),
    []
  )

  const formatNumber = (value: number | null | undefined) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return '0'
    }
    return numberFormatter.format(value)
  }

  const formatSignedNumber = (value: number | null | undefined) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return '0'
    }
    if (value > 0) {
      return `+${numberFormatter.format(value)}`
    }
    if (value < 0) {
      return `-${numberFormatter.format(Math.abs(value))}`
    }
    return '0'
  }

  const formatCurrency = (value: number | null | undefined): string | null => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return null
    }
    return currencyFormatter.format(value)
  }

  useEffect(() => {
    if (isReady) {
      loadMovements()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, searchQuery, movementTypeFilter, dateFrom, dateTo, currentPage])

  const loadMovements = async () => {
    try {
      setLoading(true)
      
      // Try using the optimized ordered view first, fallback to base table if unavailable
      let tableName = 'vw_stock_movements_ordered'
      let query = supabase
        .from(tableName)
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .range((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage - 1)

      // Apply filters
      if (searchQuery) {
        // Note: search on variant won't work without join, but we'll handle it client-side
        query = query.or(
          [
            'reference_no',
            'notes',
            'movement_type',
            'variant_code',
            'variant_name',
            'product_name',
            'organization_name',
            'manufacturer_name',
            'created_by_email'
          ]
            .map((column) => `${column}.ilike.%${searchQuery}%`)
            .join(',')
        )
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

      let { data, error } = await query

      // If view doesn't exist, fallback to stock_movements table
      if (error && (error.message?.includes('does not exist') || error.code === '42P01')) {
        console.log('View not found, using stock_movements table as fallback')
        tableName = 'stock_movements'
        query = supabase
          .from(tableName)
          .select(`
            id,
            movement_type,
            reference_type,
            reference_id,
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
            variant_id,
            to_organization_id,
            manufacturer_id,
            created_by
          `)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage - 1)

        // Re-apply filters
        if (searchQuery) {
          query = query.or(
            ['reference_no', 'notes', 'movement_type', 'reason', 'warehouse_location']
              .map((column) => `${column}.ilike.%${searchQuery}%`)
              .join(',')
          )
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

        const result = await query
        data = result.data
        error = result.error
      }

      if (error) {
        console.error('Query error details:', error)
        throw error
      }
      
      if (!data || data.length === 0) {
        setMovements([])
        return
      }

      // Fetch related data separately when not already provided by the view
      const variantIds = Array.from(new Set(data.map((item: any) => item.variant_id).filter(Boolean)))
      const orgIds = Array.from(new Set([
        ...data.map((item: any) => item.to_organization_id),
        ...data.map((item: any) => item.manufacturer_id)
      ].filter(Boolean)))
      const userIds = Array.from(new Set(data.map((item: any) => item.created_by).filter(Boolean)))
      const orderIds = Array.from(new Set(
        data
          .filter((item: any) => item.movement_type === 'order_fulfillment' && item.reference_id)
          .map((item: any) => item.reference_id)
      ))

      const needsVariantLookup = data.some(
        (item: any) =>
          item.variant_id && !item.variant_code && !item.variant_name && !item.product_name
      )
      const needsOrgLookup = data.some(
        (item: any) =>
          (item.to_organization_id && !item.organization_name && !item.to_organization_name) ||
          (item.manufacturer_id && !item.manufacturer_name && !item.manufacturer_org_name)
      )
      const needsUserLookup = data.some(
        (item: any) => item.created_by && !item.created_by_email
      )

      // Fetch variants if needed
      const variantsMap = new Map()
      if (variantIds.length > 0) {
        const { data: variants } = await supabase
          .from('product_variants')
          .select('id, variant_code, variant_name, base_cost, products(product_name)')
          .in('id', variantIds)

        variants?.forEach((v: any) => {
          variantsMap.set(v.id, v)
        })
      }

      // Fetch organizations if needed
      const orgsMap = new Map()
      if (needsOrgLookup && orgIds.length > 0) {
        const { data: orgs } = await supabase
          .from('organizations')
          .select('id, org_name, org_code')
          .in('id', orgIds)
        
        orgs?.forEach((o: any) => {
          orgsMap.set(o.id, o)
        })
      }

      // Fetch users if needed
      const usersMap = new Map()
      if (needsUserLookup && userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, email')
          .in('id', userIds)
        
        users?.forEach((u: any) => {
          usersMap.set(u.id, u)
        })
      }

      const ordersMap = new Map()
      if (orderIds.length > 0) {
        const { data: orders } = await supabase
          .from('orders')
          .select('id, order_no')
          .in('id', orderIds)

        orders?.forEach((order: any) => {
          ordersMap.set(order.id, order)
        })
      }
      
      // Transform the data with fetched relations
      const transformedData: StockMovement[] = (data || []).map((item: any) => {
        const variant = variantsMap.get(item.variant_id)
        const toOrg = orgsMap.get(item.to_organization_id)
        const mfgOrg = orgsMap.get(item.manufacturer_id)
        const user = usersMap.get(item.created_by)
        const order = item.reference_id ? ordersMap.get(item.reference_id) : null
        const isShipment = item.movement_type === 'order_fulfillment'

        const viewVariantCode = item.variant_code || item.variant_identifier || null
        const viewVariantName = item.variant_name || null
        const viewProductName = item.product_name || item.product_display_name || null

        const resolvedVariantProducts = (() => {
          if (viewProductName) {
            return { product_name: viewProductName }
          }

          if (!variant) return null

          if (Array.isArray(variant.products)) {
            return variant.products[0] || null
          }

          return variant.products || null
        })()

        const variantBaseCost = (() => {
          const viewBaseCost = typeof item.base_cost === 'number' && !Number.isNaN(item.base_cost)
            ? Number(item.base_cost)
            : null
          const lookupBase = variant && typeof variant.base_cost === 'number' && !Number.isNaN(variant.base_cost)
            ? Number(variant.base_cost)
            : null

          if (viewBaseCost !== null) return viewBaseCost
          if (lookupBase !== null) return lookupBase
          return null
        })()

        const productVariants = (() => {
          if (viewVariantCode || viewVariantName || resolvedVariantProducts) {
            return {
              variant_code: viewVariantCode ?? variant?.variant_code ?? '',
              variant_name: viewVariantName ?? variant?.variant_name ?? '',
              base_cost: variantBaseCost,
              products: resolvedVariantProducts
            }
          }

          if (variant) {
            return {
              variant_code: variant.variant_code,
              variant_name: variant.variant_name,
              base_cost: variantBaseCost,
              products: resolvedVariantProducts
            }
          }

          return null
        })()

        const viewOrgName = item.organization_name || item.to_organization_name || null
        const viewOrgCode = item.organization_code || item.to_organization_code || null
        const organizations = (() => {
          if (viewOrgName || viewOrgCode) {
            return {
              org_name: viewOrgName ?? toOrg?.org_name ?? '',
              org_code: viewOrgCode ?? toOrg?.org_code ?? ''
            }
          }

          if (toOrg) {
            return toOrg
          }

          return null
        })()

        const viewMfgName = item.manufacturer_name || item.manufacturer_org_name || null
        const manufacturers = (() => {
          if (viewMfgName) {
            return { org_name: viewMfgName }
          }

          if (mfgOrg) {
            return { org_name: mfgOrg.org_name }
          }

          return null
        })()

        const viewUserEmail = item.created_by_email || null
        const users = (() => {
          if (viewUserEmail) {
            return { email: viewUserEmail }
          }

          if (user) {
            return user
          }

          return null
        })()

        const quantityChange = Number(item.quantity_change ?? 0)
        const resolvedUnitCost = (() => {
          if (variantBaseCost !== null) return variantBaseCost
          const directCost = typeof item.unit_cost === 'number' && !Number.isNaN(item.unit_cost)
            ? Number(item.unit_cost)
            : null
          if (directCost !== null && directCost !== 0) {
            return directCost
          }
          const averageCost = typeof item.average_cost === 'number' && !Number.isNaN(item.average_cost)
            ? Number(item.average_cost)
            : null
          return averageCost
        })()

        const resolvedTotalCost = (() => {
          const directTotal = typeof item.total_cost === 'number' && !Number.isNaN(item.total_cost)
            ? Number(item.total_cost)
            : null

          if (directTotal !== null && directTotal !== 0) {
            return directTotal
          }

          if (resolvedUnitCost !== null && Number.isFinite(quantityChange) && quantityChange !== 0) {
            return Number((Math.abs(quantityChange) * resolvedUnitCost).toFixed(2))
          }

          if (resolvedUnitCost !== null && quantityChange === 0) {
            return 0
          }

          return null
        })()

        return {
          ...item,
          unit_cost: resolvedUnitCost,
          total_cost: resolvedTotalCost,
          reference_no: isShipment && order?.order_no ? order.order_no : item.reference_no,
          distributor_order_no: order?.order_no || null,
          product_variants: productVariants,
          organizations,
          manufacturers,
          users
        }
      })
      
      setMovements(transformedData)
    } catch (error: any) {
      console.error('Failed to load movements:', error)
    } finally {
      setLoading(false)
    }
  }

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

  const getSortedMovements = () => {
    if (!sortColumn) return movements

    const sorted = [...movements].sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortColumn) {
        case 'created_at':
          aValue = new Date(a.created_at).getTime()
          bValue = new Date(b.created_at).getTime()
          break
        case 'movement_type':
          aValue = a.movement_type || ''
          bValue = b.movement_type || ''
          break
        case 'product_name':
          aValue = a.product_variants?.products?.product_name || ''
          bValue = b.product_variants?.products?.product_name || ''
          break
        case 'variant_code':
          aValue = a.product_variants?.variant_code || ''
          bValue = b.product_variants?.variant_code || ''
          break
        case 'location':
          aValue = a.organizations?.org_name || ''
          bValue = b.organizations?.org_name || ''
          break
        case 'quantity_change':
          aValue = a.quantity_change
          bValue = b.quantity_change
          break
        case 'quantity_before':
          aValue = a.quantity_before
          bValue = b.quantity_before
          break
        case 'quantity_after':
          aValue = a.quantity_after
          bValue = b.quantity_after
          break
        case 'unit_cost':
          aValue = a.unit_cost || 0
          bValue = b.unit_cost || 0
          break
        case 'reference_no':
          aValue = a.reference_no || ''
          bValue = b.reference_no || ''
          break
        case 'reason':
          aValue = a.reason || ''
          bValue = b.reason || ''
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

  const getReasonText = (movement: StockMovement) => {
    if (movement.movement_type === 'order_fulfillment') {
      const destination = movement.organizations?.org_name
      if (destination) {
        return `Shipment to ${destination}`
      }
      return 'Shipment to distributor'
    }

    return movement.reason || ''
  }

  const getMovementTypeBadge = (type: string) => {
    const configs: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      'addition': { label: 'Addition', variant: 'default' as const },
      'adjustment': { label: 'Adjustment', variant: 'secondary' as const },
      'transfer_out': { label: 'Transfer Out', variant: 'outline' as const },
      'transfer_in': { label: 'Transfer In', variant: 'default' as const },
      'allocation': { label: 'Allocated', variant: 'secondary' as const },
      'deallocation': { label: 'Deallocated', variant: 'outline' as const },
      'order_fulfillment': { label: 'Shipment', variant: 'destructive' as const },
      'order_cancelled': { label: 'Cancelled', variant: 'outline' as const },
      'manual_in': { label: 'manual_in', variant: 'default' as const },
      'manual_out': { label: 'manual_out', variant: 'destructive' as const }
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <Card>
          <CardHeader className="pb-2 sm:pb-3">
            <CardTitle className="text-xs sm:text-sm font-medium text-gray-600">Total Movements</CardTitle>
          </CardHeader>
          <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
              <span className="text-xl sm:text-2xl font-bold">{formatNumber(movements.length)}</span>
            </div>
            <p className="text-xs text-gray-500 mt-1 hidden sm:block">Current page records</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 sm:pb-3">
            <CardTitle className="text-xs sm:text-sm font-medium text-gray-600">Stock Additions</CardTitle>
          </CardHeader>
          <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
              <span className="text-xl sm:text-2xl font-bold text-green-600">
                {totalIncrease > 0 ? '+' : ''}{formatNumber(totalIncrease)}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1 hidden sm:block">Units added</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 sm:pb-3">
            <CardTitle className="text-xs sm:text-sm font-medium text-gray-600">Stock Reductions</CardTitle>
          </CardHeader>
          <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5 text-red-600" />
              <span className="text-xl sm:text-2xl font-bold text-red-600">
                {totalDecrease > 0 ? `-${formatNumber(totalDecrease)}` : '0'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1 hidden sm:block">Units removed</p>
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
                  <SelectItem value="manual_in">manual_in</SelectItem>
                  <SelectItem value="manual_out">manual_out</SelectItem>
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
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('created_at')}
                  >
                    <div className="flex items-center">
                      Date/Time
                      {renderSortIcon('created_at')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('movement_type')}
                  >
                    <div className="flex items-center">
                      Type
                      {renderSortIcon('movement_type')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('product_name')}
                  >
                    <div className="flex items-center">
                      Product
                      {renderSortIcon('product_name')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('variant_code')}
                  >
                    <div className="flex items-center">
                      Variant
                      {renderSortIcon('variant_code')}
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
                    className="cursor-pointer hover:bg-gray-100 select-none text-right"
                    onClick={() => handleSort('quantity_change')}
                  >
                    <div className="flex items-center justify-end">
                      Change
                      {renderSortIcon('quantity_change')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100 select-none text-right"
                    onClick={() => handleSort('quantity_before')}
                  >
                    <div className="flex items-center justify-end">
                      Before
                      {renderSortIcon('quantity_before')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100 select-none text-right"
                    onClick={() => handleSort('quantity_after')}
                  >
                    <div className="flex items-center justify-end">
                      After
                      {renderSortIcon('quantity_after')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100 select-none text-right"
                    onClick={() => handleSort('unit_cost')}
                  >
                    <div className="flex items-center justify-end">
                      Cost
                      {renderSortIcon('unit_cost')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('reference_no')}
                  >
                    <div className="flex items-center">
                      Reference
                      {renderSortIcon('reference_no')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('reason')}
                  >
                    <div className="flex items-center">
                      Reason
                      {renderSortIcon('reason')}
                    </div>
                  </TableHead>
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
                  getSortedMovements().map((movement) => (
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
                      <TableCell
                        className={`text-right font-semibold ${
                          movement.quantity_change > 0
                            ? 'text-green-600'
                            : movement.quantity_change < 0
                              ? 'text-red-600'
                              : 'text-gray-600'
                        }`}
                      >
                        {formatSignedNumber(movement.quantity_change)}
                      </TableCell>
                      <TableCell className="text-right text-gray-600">
                        {formatNumber(movement.quantity_before)}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatNumber(movement.quantity_after)}
                      </TableCell>
                      <TableCell className="text-right">
                        {(() => {
                          const formattedUnitCost = formatCurrency(movement.unit_cost)
                          const formattedTotalCost = formatCurrency(movement.total_cost)

                          if (!formattedUnitCost) {
                            return '-'
                          }

                          return (
                            <div>
                              <p className="text-sm">{formattedUnitCost}</p>
                              {formattedTotalCost && (
                                <p className="text-xs text-gray-500">
                                  Total: {formattedTotalCost}
                                </p>
                              )}
                            </div>
                          )
                        })()}
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
                        {(() => {
                          const reasonText = getReasonText(movement)
                          if (!reasonText) return null
                          return (
                            <p className="text-gray-700 truncate" title={reasonText}>
                              {reasonText}
                            </p>
                          )
                        })()}
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
