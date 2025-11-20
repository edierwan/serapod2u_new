'use client'

import { useState, useEffect, useMemo } from 'react'
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
  variant_id?: string | null
  variant_code?: string | null
  variant_name?: string | null
  product_name?: string | null
  product_code?: string | null
  organization_id?: string | null
  organization_name?: string | null
  organization_code?: string | null
  quantity_on_hand: number
  quantity_allocated: number
  quantity_available: number
  reorder_point: number
  reorder_quantity: number
  unit_cost: number | null
  total_value: number | null
  manual_balance_qty?: number | null
  warehouse_location: string | null
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
  const [productFilter, setProductFilter] = useState('all')
  const [valueRangeFilter, setValueRangeFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [locations, setLocations] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  
  const { isReady, supabase } = useSupabaseAuth()
  const itemsPerPage = 15

  const formatNumber = (value?: number | null) => {
    if (value === null || value === undefined) {
      return '0'
    }
    return new Intl.NumberFormat('en-MY').format(value)
  }

  useEffect(() => {
    if (isReady) {
      fetchInventory()
      fetchLocations()
      fetchProducts()
    }
  }, [isReady])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, locationFilter, statusFilter, productFilter, valueRangeFilter])

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
    setCurrentPage(1)
  }

  const filteredInventory = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase()

    return inventory.filter(item => {
      const matchesLocation = locationFilter === 'all' || item.organization_id === locationFilter

      let matchesStatus = true
      if (statusFilter === 'low_stock') {
        matchesStatus = item.quantity_available > 0 && item.quantity_available <= item.reorder_point
      } else if (statusFilter === 'out_of_stock') {
        matchesStatus = item.quantity_available <= 0
      } else if (statusFilter === 'in_stock') {
        matchesStatus = item.quantity_available > 0
      }

      const matchesProduct = productFilter === 'all' || item.product_name === productFilter

      let matchesValueRange = true
      const totalValue = item.total_value ?? 0
      if (valueRangeFilter === 'under_1000') {
        matchesValueRange = totalValue < 1000
      } else if (valueRangeFilter === '1000_5000') {
        matchesValueRange = totalValue >= 1000 && totalValue < 5000
      } else if (valueRangeFilter === '5000_10000') {
        matchesValueRange = totalValue >= 5000 && totalValue < 10000
      } else if (valueRangeFilter === 'over_10000') {
        matchesValueRange = totalValue >= 10000
      }

      if (!normalizedSearch) {
        return matchesLocation && matchesStatus && matchesProduct && matchesValueRange
      }

      const haystack = [
        item.variant_code,
        item.variant_name,
        item.product_name,
        item.product_code,
        item.organization_name,
        item.organization_code
      ]
        .filter(Boolean)
        .map(value => String(value).toLowerCase())

      const matchesSearch = haystack.some(value => value.includes(normalizedSearch))

      return matchesLocation && matchesStatus && matchesProduct && matchesValueRange && matchesSearch
    })
  }, [inventory, searchQuery, locationFilter, statusFilter, productFilter, valueRangeFilter])

  const sortedInventory = useMemo(() => {
    if (!sortColumn) {
      return [...filteredInventory]
    }

    const sorted = [...filteredInventory].sort((a, b) => {
      let aValue: any
      let bValue: any

      switch (sortColumn) {
        case 'variant_code':
          aValue = a.variant_code || ''
          bValue = b.variant_code || ''
          break
        case 'product_name':
          aValue = a.product_name || ''
          bValue = b.product_name || ''
          break
        case 'location':
          aValue = a.organization_name || ''
          bValue = b.organization_name || ''
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
          aValue = a.total_value ?? 0
          bValue = b.total_value ?? 0
          break
        default:
          return 0
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue)
      }

      if (sortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0
      }

      return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
    })

    return sorted
  }, [filteredInventory, sortColumn, sortDirection])

  const paginatedInventory = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    const end = start + itemsPerPage
    return sortedInventory.slice(start, end)
  }, [sortedInventory, currentPage, itemsPerPage])

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
      let source: 'view' | 'fallback' = 'view'
      let data: any[] | null = null

      const { data: viewData, error: viewError } = await supabase
        .from('vw_inventory_on_hand')
        .select('*')

      if (viewError) {
        const missingView = (() => {
          const code = typeof viewError.code === 'string' ? viewError.code.toUpperCase() : null
          if (code === '42P01' || code === 'PGRST103' || code === 'PGRST204') {
            return true
          }
          const message = typeof viewError.message === 'string' ? viewError.message.toLowerCase() : ''
          return message.includes('vw_inventory_on_hand') || message.includes('schema cache')
        })()

        if (!missingView) {
          throw viewError
        }

        console.warn('vw_inventory_on_hand unavailable, using product_inventory fallback', viewError)
        source = 'fallback'

        const { data: fallbackData, error: fallbackError } = await supabase
          .from('product_inventory')
          .select(`
            id,
            variant_id,
            organization_id,
            quantity_on_hand,
            quantity_allocated,
            quantity_available,
            reorder_point,
            reorder_quantity,
            average_cost,
            total_value,
            warehouse_location,
            product_variants (
              id,
              variant_code,
              variant_name,
              base_cost,
              products (
                product_name,
                product_code
              )
            ),
            organizations (
              id,
              org_name,
              org_code
            )
          `)
          .eq('is_active', true)

        if (fallbackError) {
          console.error('Fallback inventory query failed:', fallbackError)
          throw fallbackError
        }

        data = fallbackData || []
      } else {
        data = viewData || []
      }

      const parseNumber = (value: any): number | null => {
        if (value === null || value === undefined || value === '') {
          return null
        }
        const numeric = Number(value)
        return Number.isFinite(numeric) ? numeric : null
      }

      const variantBaseCostMap = new Map<string, number>()
      const collectedVariantIds = Array.from(
        new Set(
          (data || [])
            .map((record: any) => {
              if (record?.variant_id) return record.variant_id
              const variantRelation = Array.isArray(record?.product_variants)
                ? record.product_variants[0]
                : record?.product_variants
              return variantRelation?.id ?? null
            })
            .filter(Boolean)
        )
      )

      if (collectedVariantIds.length > 0) {
        const { data: variantCostRows, error: variantCostError } = await supabase
          .from('product_variants')
          .select('id, base_cost')
          .in('id', collectedVariantIds as string[])

        if (!variantCostError) {
          variantCostRows?.forEach((row: any) => {
            if (row?.id && row?.base_cost !== null && row?.base_cost !== undefined) {
              const parsed = Number(row.base_cost)
              if (!Number.isNaN(parsed)) {
                variantBaseCostMap.set(row.id, parsed)
              }
            }
          })
        } else {
          console.warn('Failed to load variant base cost data for inventory fallback', variantCostError)
        }
      }

      let normalized: InventoryItem[] = (data || []).map((item: any, index: number) => {
        const rawVariant = Array.isArray(item.product_variants)
          ? item.product_variants[0]
          : item.product_variants

        const rawProduct = rawVariant?.products
          ? Array.isArray(rawVariant.products)
            ? rawVariant.products[0]
            : rawVariant.products
          : null

        const rawOrg = Array.isArray(item.organizations)
          ? item.organizations[0]
          : item.organizations

        const variantId = item.variant_id ?? rawVariant?.id ?? null
        const organizationId = item.organization_id ?? rawOrg?.id ?? null

        const variantBaseCostCandidates: Array<number | null> = []
        if (variantId && variantBaseCostMap.has(variantId)) {
          variantBaseCostCandidates.push(variantBaseCostMap.get(variantId) ?? null)
        }
        variantBaseCostCandidates.push(parseNumber(rawVariant?.base_cost))
        variantBaseCostCandidates.push(parseNumber(item.base_cost))

        const variantBaseCost = variantBaseCostCandidates.find(cost => cost !== null) ?? null

  const quantityOnHand = parseNumber(item.quantity_on_hand) ?? 0
  const allocatedQuantity = parseNumber(item.quantity_allocated) ?? 0
  const quantityAvailable = parseNumber(item.quantity_available) ?? quantityOnHand

        const resolvedUnitCost = (() => {
          if (variantBaseCost !== null) return variantBaseCost
          const directUnit = parseNumber(item.unit_cost)
          if (directUnit !== null && directUnit !== 0) return directUnit
          const average = parseNumber(item.average_cost)
          return average
        })()

        const resolvedTotalValue = (() => {
          if (resolvedUnitCost !== null) {
            return Number((quantityOnHand * resolvedUnitCost).toFixed(2))
          }
          const directTotal = parseNumber(item.total_value)
          if (directTotal !== null) return directTotal
          return null
        })()

        return {
          id: item.id || `${organizationId || 'org'}-${variantId || rawVariant?.variant_code || index}`,
          variant_id: variantId,
          variant_code: item.variant_code ?? rawVariant?.variant_code ?? null,
          variant_name: item.variant_name ?? rawVariant?.variant_name ?? null,
          product_name: item.product_name ?? rawProduct?.product_name ?? null,
          product_code: item.product_code ?? rawProduct?.product_code ?? null,
          organization_id: organizationId,
          organization_name: item.organization_name ?? rawOrg?.org_name ?? null,
          organization_code: item.organization_code ?? rawOrg?.org_code ?? null,
          quantity_on_hand: quantityOnHand,
          quantity_allocated: allocatedQuantity,
          quantity_available: quantityAvailable,
          reorder_point: Number(item.reorder_point ?? 0),
          reorder_quantity: Number(item.reorder_quantity ?? 0),
          unit_cost: resolvedUnitCost,
          total_value: resolvedTotalValue,
          manual_balance_qty:
            item.manual_balance_qty !== undefined && item.manual_balance_qty !== null
              ? Number(item.manual_balance_qty)
              : null,
          warehouse_location: item.warehouse_location ?? null
        }
      })

      if (source === 'fallback' && normalized.length > 0) {
        const combos = normalized.filter(item => item.variant_id && item.organization_id)
        const variantIds = Array.from(new Set(combos.map(item => item.variant_id!).filter(Boolean)))
        const organizationIds = Array.from(new Set(combos.map(item => item.organization_id!).filter(Boolean)))

        if (variantIds.length > 0 && organizationIds.length > 0) {
          const organizationIdSet = new Set(organizationIds)
          const manualBalanceMap = new Map<string, number>()

          const { data: manualViewData, error: manualViewError } = await supabase
            .from('vw_manual_stock_balance')
            .select('warehouse_id, variant_id, manual_balance_qty')
            .in('variant_id', variantIds)
            .in('warehouse_id', organizationIds)

          if (!manualViewError) {
            manualViewData?.forEach((row: any) => {
              if (!row?.warehouse_id || !row?.variant_id) return
              const key = `${row.warehouse_id}:${row.variant_id}`
              manualBalanceMap.set(key, Number(row.manual_balance_qty ?? 0))
            })
          } else {
            console.warn('vw_manual_stock_balance unavailable, aggregating manual balance from stock_movements', manualViewError)
            const { data: manualMovementData, error: manualMovementError } = await supabase
              .from('stock_movements')
              .select('variant_id, movement_type, to_organization_id, from_organization_id, quantity_change')
              .in('variant_id', variantIds)
              .in('movement_type', ['manual_in', 'manual_out'])

            if (!manualMovementError) {
              manualMovementData?.forEach((movement: any) => {
                const targetOrg = movement.movement_type === 'manual_in'
                  ? movement.to_organization_id
                  : movement.from_organization_id

                if (!targetOrg || !movement.variant_id) {
                  return
                }

                if (!organizationIdSet.has(targetOrg)) {
                  return
                }

                const key = `${targetOrg}:${movement.variant_id}`
                const existing = manualBalanceMap.get(key) ?? 0
                const delta = Number(movement.quantity_change ?? 0)
                manualBalanceMap.set(key, existing + delta)
              })
            } else {
              console.error('Failed to aggregate manual stock balance fallback:', manualMovementError)
            }
          }

          if (manualBalanceMap.size > 0) {
            normalized = normalized.map(item => {
              if (!item.organization_id || !item.variant_id) {
                return item
              }
              const key = `${item.organization_id}:${item.variant_id}`
              if (!manualBalanceMap.has(key)) {
                return item
              }
              return {
                ...item,
                manual_balance_qty: manualBalanceMap.get(key) ?? item.manual_balance_qty ?? null
              }
            })
          }

          const movementTotalsMap = new Map<string, number>()
          try {
            const { data: movementTotalsData, error: movementTotalsError } = await supabase
              .from('stock_movements')
              .select('variant_id, quantity_change, from_organization_id, to_organization_id')
              .in('variant_id', variantIds)
              .or(`from_organization_id.in.(${organizationIds.join(',')}),to_organization_id.in.(${organizationIds.join(',')})`)

            if (!movementTotalsError) {
              movementTotalsData?.forEach((movement: any) => {
                const variantId = movement?.variant_id
                if (!variantId) {
                  return
                }

                const qty = Number(movement.quantity_change ?? 0)
                if (!Number.isFinite(qty) || qty === 0) {
                  return
                }

                const toOrg = movement.to_organization_id
                if (toOrg && organizationIdSet.has(toOrg)) {
                  const key = `${toOrg}:${variantId}`
                  movementTotalsMap.set(key, (movementTotalsMap.get(key) ?? 0) + qty)
                }

                const fromOrg = movement.from_organization_id
                if (fromOrg && organizationIdSet.has(fromOrg)) {
                  const key = `${fromOrg}:${variantId}`
                  movementTotalsMap.set(key, (movementTotalsMap.get(key) ?? 0) + qty)
                }
              })
            } else {
              console.error('Failed to recalculate on-hand from stock_movements:', movementTotalsError)
            }
          } catch (movementError) {
            console.error('Unexpected error while recalculating fallback inventory totals:', movementError)
          }

          if (movementTotalsMap.size > 0) {
            normalized = normalized.map(item => {
              if (!item.organization_id || !item.variant_id) {
                return item
              }

              const key = `${item.organization_id}:${item.variant_id}`
              if (!movementTotalsMap.has(key)) {
                return item
              }

              const recalculatedOnHand = Number(movementTotalsMap.get(key))
              if (!Number.isFinite(recalculatedOnHand)) {
                return item
              }

              const allocated = Number(item.quantity_allocated ?? 0)
              const recalculatedAvailable = recalculatedOnHand - (Number.isFinite(allocated) ? allocated : 0)

              const hasUnitCost = typeof item.unit_cost === 'number' && Number.isFinite(item.unit_cost)
              const existingTotal = typeof item.total_value === 'number' && Number.isFinite(item.total_value)
                ? item.total_value
                : null
              const previousOnHand = Number(item.quantity_on_hand ?? 0)

              let recalculatedTotal = existingTotal

              if (hasUnitCost) {
                recalculatedTotal = Number((recalculatedOnHand * (item.unit_cost as number)).toFixed(2))
              } else if (existingTotal !== null && previousOnHand > 0 && previousOnHand !== recalculatedOnHand) {
                const derivedUnitCost = existingTotal / previousOnHand
                if (Number.isFinite(derivedUnitCost)) {
                  recalculatedTotal = Number((recalculatedOnHand * derivedUnitCost).toFixed(2))
                }
              }

              return {
                ...item,
                quantity_on_hand: recalculatedOnHand,
                quantity_available: recalculatedAvailable,
                total_value: recalculatedTotal
              }
            })
          }
        }
      }

      if (source === 'fallback') {
        console.info(`Inventory fallback loaded ${normalized.length} records from product_inventory`)
      }

      setInventory(normalized)
    } catch (error: any) {
      const errorMessage = typeof error?.message === 'string' ? error.message : error
      console.error('Error fetching inventory:', errorMessage, error)
      setInventory([])
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

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('product_name')
        .eq('is_active', true)
        .order('product_name')

      if (error) throw error
      // Get unique product names
      const uniqueProducts = Array.from(new Set((data || []).map(p => p.product_name)))
      setProducts(uniqueProducts.map(name => ({ product_name: name })))
    } catch (error) {
      console.error('Error fetching products:', error)
    }
  }

  const formatCurrency = (value?: number | null) => {
    const numeric = value !== null && value !== undefined && !Number.isNaN(value) ? value : 0
    return numeric.toLocaleString(undefined, {
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
  const totalValue = filteredInventory.reduce((sum, item) => sum + (item.total_value ?? 0), 0)
  const inStockItems = filteredInventory.filter(item => item.quantity_available > 0).length
  const lowStockItems = filteredInventory.filter(item => item.quantity_available <= item.reorder_point && item.quantity_available > 0).length
  const outOfStockItems = filteredInventory.filter(item => item.quantity_available <= 0).length
  const inStockPercentage = filteredInventory.length > 0 ? Math.round((inStockItems / filteredInventory.length) * 100) : 0

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
            <p className="text-xs text-gray-600 hidden sm:block">{inStockItems} of {filteredInventory.length} items</p>
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
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <Input
                placeholder="Search by product name, variant code, or location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Filter Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-700 mb-1.5 block">Location</label>
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Locations" />
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
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 mb-1.5 block">Product</label>
                <Select value={productFilter} onValueChange={setProductFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Products" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Products</SelectItem>
                    {products.map((product, idx) => (
                      <SelectItem key={idx} value={product.product_name}>
                        {product.product_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 mb-1.5 block">Stock Status</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="in_stock">In Stock</SelectItem>
                    <SelectItem value="low_stock">Low Stock</SelectItem>
                    <SelectItem value="out_of_stock">Out of Stock</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 mb-1.5 block">Value Range</label>
                <Select value={valueRangeFilter} onValueChange={setValueRangeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Values" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Values</SelectItem>
                    <SelectItem value="under_1000">Under RM 1,000</SelectItem>
                    <SelectItem value="1000_5000">RM 1,000 - 5,000</SelectItem>
                    <SelectItem value="5000_10000">RM 5,000 - 10,000</SelectItem>
                    <SelectItem value="over_10000">Over RM 10,000</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Active Filters & Clear Button */}
            {(searchQuery || locationFilter !== 'all' || statusFilter !== 'all' || productFilter !== 'all' || valueRangeFilter !== 'all') && (
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-600">Active filters:</span>
                  {searchQuery && <Badge variant="secondary">Search: {searchQuery}</Badge>}
                  {locationFilter !== 'all' && <Badge variant="secondary">Location</Badge>}
                  {productFilter !== 'all' && <Badge variant="secondary">Product</Badge>}
                  {statusFilter !== 'all' && <Badge variant="secondary">Status</Badge>}
                  {valueRangeFilter !== 'all' && <Badge variant="secondary">Value Range</Badge>}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('')
                    setLocationFilter('all')
                    setProductFilter('all')
                    setStatusFilter('all')
                    setValueRangeFilter('all')
                  }}
                  className="text-gray-600 hover:text-gray-900"
                >
                  Clear All Filters
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Inventory Table */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory Items</CardTitle>
          <CardDescription>
            {loading ? 'Loading...' : `${filteredInventory.length} inventory items found`}
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
                paginatedInventory.map((item: InventoryItem) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-sm">
                      {item.variant_code || 'N/A'}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">
                          {item.product_name || 'Unknown Product'}
                        </p>
                        <p className="text-sm text-gray-600">
                          {item.variant_name || 'No variant'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{item.organization_name || 'Unknown Location'}</p>
                        {item.warehouse_location && (
                          <p className="text-sm text-gray-600">{item.warehouse_location}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{formatNumber(item.quantity_on_hand)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-gray-600">{formatNumber(item.quantity_allocated)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{formatNumber(item.quantity_available)}</span>
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
                          Reorder at: {formatNumber(item.reorder_point)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium">
                        RM {formatCurrency(item.total_value ?? 0)}
                      </span>
                      <p className="text-sm text-gray-600">
                        @ RM {formatCurrency(item.unit_cost ?? 0)} per unit
                      </p>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-gray-600 text-sm">
              {filteredInventory.length === 0
                ? 'No items to display'
                : `Showing ${(currentPage - 1) * itemsPerPage + 1} to ${Math.min(currentPage * itemsPerPage, filteredInventory.length)} of ${filteredInventory.length} items`}
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
                disabled={currentPage * itemsPerPage >= filteredInventory.length}
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