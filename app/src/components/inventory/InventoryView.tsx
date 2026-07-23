'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { usePermissions } from '@/hooks/usePermissions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
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
  ArrowDown,
  Settings
} from 'lucide-react'
import SupplyChainPageHeader from '@/modules/supply-chain/components/SupplyChainPageHeader'
import ProductThumbnail from './ProductThumbnail'
import StockSettingsPanel from './StockSettingsPanel'
import IncomingStockDialog from './IncomingStockDialog'
import {
  buildIncomingMap,
  getIncomingBreakdown,
  getReplenishmentDecision,
  incomingKey,
  type IncomingBreakdown,
  type IncomingStockRow
} from '@/lib/inventory/incoming-stock'

interface InventoryItem {
  id: string
  variant_id?: string | null
  variant_code?: string | null
  variant_name?: string | null
  variant_image_url?: string | null
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
  max_stock_level?: number | null
  safety_stock?: number | null
  lead_time_days?: number | null
  unit_cost: number | null
  total_value: number | null
  manual_balance_qty?: number | null
  warehouse_location: string | null
  updated_at?: string | null
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
  const [variantFilter, setVariantFilter] = useState('all')
  const [valueRangeFilter, setValueRangeFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [locations, setLocations] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [variants, setVariants] = useState<any[]>([])
  const [sortColumn, setSortColumn] = useState<string | null>('updated_at')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [incomingMap, setIncomingMap] = useState<Map<string, IncomingStockRow>>(new Map())
  const [incomingDetailItem, setIncomingDetailItem] = useState<InventoryItem | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()
  const { hasPermission } = usePermissions(
    userProfile?.roles?.role_level,
    userProfile?.role_code,
    userProfile?.department_id
  )
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
      fetchIncoming()
      fetchLocations()
      fetchProducts()
      fetchVariants()
    }
  }, [isReady])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, locationFilter, statusFilter, productFilter, variantFilter, valueRangeFilter])

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

      const matchesVariant = variantFilter === 'all' || item.variant_code === variantFilter

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
        return matchesLocation && matchesStatus && matchesProduct && matchesVariant && matchesValueRange
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

      return matchesLocation && matchesStatus && matchesProduct && matchesVariant && matchesValueRange && matchesSearch
    })
  }, [inventory, searchQuery, locationFilter, statusFilter, productFilter, variantFilter, valueRangeFilter])

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
        case 'incoming':
          aValue = getIncomingQty(a)
          bValue = getIncomingQty(b)
          break
        case 'position':
          aValue = a.quantity_available + getIncomingQty(a)
          bValue = b.quantity_available + getIncomingQty(b)
          break
        case 'total_value':
          aValue = a.total_value ?? 0
          bValue = b.total_value ?? 0
          break
        case 'updated_at':
          aValue = a.updated_at ? new Date(a.updated_at).getTime() : 0
          bValue = b.updated_at ? new Date(b.updated_at).getTime() : 0
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
  }, [filteredInventory, sortColumn, sortDirection, incomingMap])

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

  const getStockStatus = (available: number, reorderPoint: number) => {
    if (available <= 0) return 'Out of Stock'
    if (available <= reorderPoint * 0.5) return 'Critical'
    if (available <= reorderPoint) return 'Low Stock'
    return 'Healthy'
  }

  const handleExport = async () => {
    setExportMessage(null)
    const canExport = hasPermission('view_inventory') && hasPermission('export_reports')

    if (!canExport) {
      setExportMessage({ type: 'error', text: 'You do not have permission to export inventory.' })
      toast({
        title: 'Export unavailable',
        description: 'You do not have permission to export inventory.',
        variant: 'destructive'
      })
      return
    }

    if (sortedInventory.length === 0) {
      setExportMessage({ type: 'error', text: 'No inventory rows match the current filters.' })
      toast({
        title: 'Nothing to export',
        description: 'No inventory rows match the current filters.',
      })
      return
    }

    try {
      setExporting(true)

      const canViewCost = hasPermission('view_inventory_cost')
      const canViewValue = hasPermission('view_inventory_value')
      const ExcelJS = (await import('exceljs')).default
      const workbook = new ExcelJS.Workbook()
      workbook.creator = 'Serapod2U'
      workbook.created = new Date()

      const worksheet = workbook.addWorksheet('Inventory', {
        views: [{ state: 'frozen', ySplit: 5 }]
      })
      const headers = [
        'No.', 'Product Name', 'Product Code / SKU', 'Variant', 'Variant Code',
        'Location / Warehouse', 'On Hand', 'Allocated', 'Available', 'Incoming',
        'Inventory Position', 'Stock Status', 'Replenishment',
        'Reorder Level', 'Unit Cost (RM)', 'Total Value (RM)', 'Last Updated'
      ]

      worksheet.mergeCells('A1:Q1')
      worksheet.getCell('A1').value = 'Current Inventory Report'
      worksheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1F2937' } }
      worksheet.getCell('A1').alignment = { vertical: 'middle' }
      worksheet.getRow(1).height = 26

      worksheet.mergeCells('A2:Q2')
      worksheet.getCell('A2').value = `Generated: ${new Date().toLocaleString('en-MY')}`
      worksheet.getCell('A2').font = { italic: true, color: { argb: 'FF4B5563' } }

      worksheet.mergeCells('A3:Q3')
      worksheet.getCell('A3').value = `Organization: ${userProfile?.organizations?.org_name || '-'}`
      worksheet.getCell('A3').font = { color: { argb: 'FF4B5563' } }

      const headerRow = worksheet.getRow(5)
      headerRow.values = headers
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      headerRow.height = 30

      sortedInventory.forEach((item, index) => {
        const location = [item.organization_name, item.warehouse_location]
          .filter((value, position, values) => value && values.indexOf(value) === position)
          .join(' — ') || '-'
        const updatedAt = item.updated_at ? new Date(item.updated_at) : null
        const validUpdatedAt = updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : '-'
        const incomingQty = getIncomingQty(item)
        const decision = getReplenishmentDecision(item.quantity_available, incomingQty, item.reorder_point)

        worksheet.addRow([
          index + 1,
          item.product_name || '-',
          item.product_code || '-',
          item.variant_name || '-',
          item.variant_code || '-',
          location,
          item.quantity_on_hand,
          item.quantity_allocated,
          item.quantity_available,
          incomingQty,
          decision.inventoryPosition,
          getStockStatus(item.quantity_available, item.reorder_point),
          decision.label,
          item.reorder_point,
          canViewCost ? (item.unit_cost ?? '-') : '-',
          canViewValue ? (item.total_value ?? '-') : '-',
          validUpdatedAt
        ])
      })

      worksheet.autoFilter = { from: 'A5', to: 'Q5' }
      worksheet.columns = [
        { width: 8 }, { width: 30 }, { width: 22 }, { width: 26 }, { width: 20 },
        { width: 32 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
        { width: 16 }, { width: 16 }, { width: 30 },
        { width: 15 }, { width: 16 }, { width: 18 }, { width: 22 }
      ]
      worksheet.getColumn(1).alignment = { horizontal: 'center' }
      ;[7, 8, 9, 10, 11, 14].forEach(column => {
        worksheet.getColumn(column).numFmt = '#,##0.00'
      })
      ;[15, 16].forEach(column => {
        worksheet.getColumn(column).numFmt = '"RM" #,##0.00;[Red]-"RM" #,##0.00'
      })
      worksheet.getColumn(17).numFmt = 'dd mmm yyyy hh:mm'

      for (let rowNumber = 6; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber)
        row.alignment = { vertical: 'middle' }
        row.eachCell(cell => {
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFD1D5DB' } } }
        })
      }

      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([new Uint8Array(buffer)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const now = new Date()
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
      link.href = url
      link.download = `Serapod2U_Inventory_${date}_${time}.xlsx`
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000)

      setExportMessage({ type: 'success', text: `Downloaded ${sortedInventory.length} inventory row(s).` })
      toast({
        title: 'Export ready',
        description: `Downloaded ${sortedInventory.length} inventory row(s).`,
      })
    } catch (error) {
      console.error('Inventory export failed:', error)
      setExportMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to export inventory.'
      })
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Unable to export inventory.',
        variant: 'destructive'
      })
    } finally {
      setExporting(false)
    }
  }

  // Incoming / On Order stock from confirmed H2M orders (v_incoming_stock).
  // Degrades gracefully to "no incoming" when the view has not been migrated yet.
  const fetchIncoming = async () => {
    if (!isReady) return
    try {
      const { data, error } = await supabase
        .from('v_incoming_stock' as any)
        .select('*')
      if (error) throw error
      setIncomingMap(buildIncomingMap((data || []) as unknown as IncomingStockRow[]))
    } catch (error) {
      console.warn('v_incoming_stock unavailable, incoming quantities hidden', error)
      setIncomingMap(new Map())
    }
  }

  // Function declarations (hoisted) — also called from the sort memo above.
  function getIncomingRow(item: InventoryItem): IncomingStockRow | undefined {
    return incomingMap.get(incomingKey(item.organization_id, item.variant_id))
  }

  /** Total Incoming = Manufacturer + Transfer. */
  function getIncomingQty(item: InventoryItem): number {
    return getIncomingRow(item)?.incoming_qty ?? 0
  }

  function getItemIncomingBreakdown(item: InventoryItem): IncomingBreakdown {
    return getIncomingBreakdown(getIncomingRow(item))
  }

  const fetchInventory = async () => {
    if (!isReady) return

    setLoading(true)
    try {
      let source: 'view' | 'fallback' = 'view'
      let data: any[] | null = null

      const pageSize = 1000
      const fetchAllPages = async (createQuery: () => any) => {
        const rows: any[] = []
        for (let from = 0; ; from += pageSize) {
          const { data: page, error } = await createQuery().range(from, from + pageSize - 1)
          if (error) return { data: null, error }
          rows.push(...(page || []))
          if (!page || page.length < pageSize) return { data: rows, error: null }
        }
      }

      const viewResult = await fetchAllPages(() => {
        let query = supabase
          .from('vw_inventory_on_hand' as any)
          .select('*')
          .order('organization_id')
          .order('variant_id')
        if (locationFilter && locationFilter !== 'all') {
          query = query.eq('organization_id', locationFilter)
        }
        return query
      })
      const { data: viewData, error: viewError } = viewResult

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

        const fallbackResult = await fetchAllPages(() => {
          let fallbackQuery = supabase
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
            max_stock_level,
            safety_stock,
            lead_time_days,
            average_cost,
            total_value,
            warehouse_location,
            updated_at,
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
            .order('organization_id')
            .order('variant_id')

          if (locationFilter && locationFilter !== 'all') {
            fallbackQuery = fallbackQuery.eq('organization_id', locationFilter)
          }
          return fallbackQuery
        })

        const { data: fallbackData, error: fallbackError } = fallbackResult

        if (fallbackError) {
          console.error('Fallback inventory query failed:', {
            error: fallbackError,
            message: fallbackError?.message,
            details: fallbackError?.details,
            hint: fallbackError?.hint,
            code: fallbackError?.code
          })
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
      const variantImageMap = new Map<string, string>()
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
          .select('id, base_cost, image_url')
          .in('id', collectedVariantIds as string[])

        if (!variantCostError) {
          variantCostRows?.forEach((row: any) => {
            if (row?.id) {
              if (row?.base_cost !== null && row?.base_cost !== undefined) {
                const parsed = Number(row.base_cost)
                if (!Number.isNaN(parsed)) {
                  variantBaseCostMap.set(row.id, parsed)
                }
              }
              if (row?.image_url) {
                variantImageMap.set(row.id, row.image_url)
              }
            }
          })
        } else {
          console.warn('Failed to load variant base cost data for inventory fallback', variantCostError)
        }
      }

      // Fetch warranty_bonus quantities to exclude from inventory value calculations
      const warrantyBonusMap = new Map<string, number>()
      const organizationIds = Array.from(
        new Set(
          (data || [])
            .map((record: any) => record?.organization_id)
            .filter(Boolean)
        )
      )

      if (collectedVariantIds.length > 0 && organizationIds.length > 0) {
        try {
          const { data: warrantyMovements, error: warrantyError } = await supabase
            .from('stock_movements')
            .select('variant_id, to_organization_id, quantity_change, movement_type')
            .in('variant_id', collectedVariantIds as string[])
            .in('to_organization_id', organizationIds as string[])
            .ilike('movement_type', 'warranty_bonus')

          if (!warrantyError && warrantyMovements) {
            warrantyMovements.forEach((movement: any) => {
              if (movement.to_organization_id && movement.variant_id) {
                const key = `${movement.to_organization_id}:${movement.variant_id}`
                const qty = Number(movement.quantity_change ?? 0)
                warrantyBonusMap.set(key, (warrantyBonusMap.get(key) ?? 0) + qty)
              }
            })
          }
        } catch (warrantyFetchError) {
          console.warn('Failed to fetch warranty_bonus quantities for inventory value calculation', warrantyFetchError)
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
            // Exclude warranty_bonus quantities from value calculation
            const key = organizationId && variantId ? `${organizationId}:${variantId}` : null
            const warrantyBonusQty = key ? (warrantyBonusMap.get(key) ?? 0) : 0
            const valuableQty = quantityOnHand - warrantyBonusQty
            return Number((valuableQty * resolvedUnitCost).toFixed(2))
          }
          const directTotal = parseNumber(item.total_value)
          if (directTotal !== null) return directTotal
          return null
        })()

        const variantImage = variantId && variantImageMap.has(variantId)
          ? variantImageMap.get(variantId)
          : (item.variant_image_url ?? rawVariant?.image_url ?? null)

        return {
          id: item.id || `${organizationId || 'org'}-${variantId || rawVariant?.variant_code || index}`,
          variant_id: variantId,
          variant_code: item.variant_code ?? rawVariant?.variant_code ?? null,
          variant_name: item.variant_name ?? rawVariant?.variant_name ?? null,
          variant_image_url: variantImage,
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
          max_stock_level: parseNumber(item.max_stock_level),
          safety_stock: parseNumber(item.safety_stock),
          lead_time_days: parseNumber(item.lead_time_days),
          unit_cost: resolvedUnitCost,
          total_value: resolvedTotalValue,
          manual_balance_qty:
            item.manual_balance_qty !== undefined && item.manual_balance_qty !== null
              ? Number(item.manual_balance_qty)
              : null,
          warehouse_location: item.warehouse_location ?? null,
          updated_at: item.updated_at ?? null
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
          // Track warranty_bonus quantities separately (they should not add to inventory value)
          const warrantyBonusMap = new Map<string, number>()
          try {
            const { data: movementTotalsData, error: movementTotalsError } = await supabase
              .from('stock_movements')
              .select('variant_id, quantity_change, from_organization_id, to_organization_id, movement_type')
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

                  // Track warranty_bonus quantities
                  const movementType = movement.movement_type ? movement.movement_type.toLowerCase().trim() : ''
                  if (movementType === 'warranty_bonus') {
                    warrantyBonusMap.set(key, (warrantyBonusMap.get(key) ?? 0) + qty)
                  }
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

              // Exclude warranty_bonus quantities from value calculation
              const warrantyBonusQty = warrantyBonusMap.get(key) ?? 0
              const valuableQty = recalculatedOnHand - warrantyBonusQty

              let recalculatedTotal = existingTotal

              if (hasUnitCost) {
                recalculatedTotal = Number((valuableQty * (item.unit_cost as number)).toFixed(2))
              } else if (existingTotal !== null && previousOnHand > 0 && previousOnHand !== recalculatedOnHand) {
                const derivedUnitCost = existingTotal / previousOnHand
                if (Number.isFinite(derivedUnitCost)) {
                  recalculatedTotal = Number((valuableQty * derivedUnitCost).toFixed(2))
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
      const { data, error } = await supabase
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
      // Fetch products that have inventory records
      const { data, error } = await supabase
        .from('product_inventory')
        .select(`
          product_variants (
            products (
              product_name
            )
          )
        `)
        .eq('is_active', true)
        .gt('quantity_on_hand', 0)

      if (error) throw error

      // Extract unique product names from inventory records
      const productNames = new Set<string>()
      data?.forEach((item: any) => {
        const variant = Array.isArray(item.product_variants)
          ? item.product_variants[0]
          : item.product_variants
        const product = variant?.products
          ? Array.isArray(variant.products)
            ? variant.products[0]
            : variant.products
          : null
        if (product?.product_name) {
          productNames.add(product.product_name)
        }
      })

      const uniqueProducts = Array.from(productNames).sort()
      setProducts(uniqueProducts.map(name => ({ product_name: name })))
    } catch (error) {
      console.error('Error fetching products:', error)
    }
  }

  const fetchVariants = async () => {
    try {
      // Fetch variants that have inventory records
      const { data, error } = await supabase
        .from('product_inventory')
        .select(`
          product_variants (
            variant_code,
            variant_name,
            products (
              product_name
            )
          )
        `)
        .eq('is_active', true)
        .gt('quantity_on_hand', 0)

      if (error) throw error

      // Extract unique variants from inventory records
      const variantMap = new Map()
      data?.forEach((item: any) => {
        const variant = Array.isArray(item.product_variants)
          ? item.product_variants[0]
          : item.product_variants
        if (variant?.variant_code) {
          variantMap.set(variant.variant_code, variant)
        }
      })

      const uniqueVariants = Array.from(variantMap.values()).sort((a, b) =>
        a.variant_code.localeCompare(b.variant_code)
      )
      setVariants(uniqueVariants)
    } catch (error) {
      console.error('Error fetching variants:', error)
    }
  }

  // Filter variants based on selected product
  const filteredVariants = useMemo(() => {
    if (productFilter === 'all') {
      return variants
    }
    return variants.filter(variant => {
      const product = Array.isArray(variant.products)
        ? variant.products[0]
        : variant.products
      return product?.product_name === productFilter
    })
  }, [variants, productFilter])

  // Reset variant filter when product filter changes
  useEffect(() => {
    if (productFilter !== 'all' && variantFilter !== 'all') {
      // Check if current variant filter is still valid for the selected product
      const isValidVariant = filteredVariants.some(v => v.variant_code === variantFilter)
      if (!isValidVariant) {
        setVariantFilter('all')
      }
    }
  }, [productFilter, variantFilter, filteredVariants])

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

  // Replenishment decision (Available + Incoming). Shown ALONGSIDE the stock
  // level badge — the physical Low Stock condition is never hidden.
  const getReplenishmentBadge = (available: number, incoming: number, reorderPoint: number) => {
    const decision = getReplenishmentDecision(available, incoming, reorderPoint)
    switch (decision.code) {
      case 'normal':
        return null
      case 'reorder_required':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Reorder Required</Badge>
      case 'replenishment_incoming':
        return <Badge variant="outline" className="bg-[var(--sera-orange)]/[0.06] text-[var(--sera-orange-deep)] border-[var(--sera-orange)]/20">Replenishment Incoming</Badge>
      case 'additional_reorder_required':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Additional Reorder Required</Badge>
    }
  }

  const canEditSettings = () => {
    const roleLevel = userProfile?.roles?.role_level
    const orgType = userProfile?.organizations?.org_type_code
    return orgType === 'HQ' && (roleLevel === 1 || roleLevel === 10) && hasPermission('manage_inventory_settings')
  }

  const canViewTotalValue = () => {
    // Use dynamic permission from database
    return hasPermission('view_inventory_value')
  }

  const handleOpenSettings = (item: InventoryItem) => {
    setSelectedItem(item)
    setSettingsOpen(true)
  }

  const handleCloseSettings = () => {
    setSettingsOpen(false)
    setSelectedItem(null)
  }

  const handleSaveSettings = () => {
    // Refresh inventory after save
    fetchInventory()
  }

  // Calculate stats
  const totalValue = filteredInventory.reduce((sum, item) => sum + (item.total_value ?? 0), 0)
  const inStockItems = filteredInventory.filter(item => item.quantity_available > 0).length
  const lowStockItems = filteredInventory.filter(item => item.quantity_available <= item.reorder_point && item.quantity_available > 0).length
  const lowStockWithIncoming = filteredInventory.filter(item =>
    item.quantity_available <= item.reorder_point && getIncomingQty(item) > 0
  ).length
  const outOfStockItems = filteredInventory.filter(item => item.quantity_available <= 0).length
  const inStockPercentage = filteredInventory.length > 0 ? Math.round((inStockItems / filteredInventory.length) * 100) : 0

  return (
    <div className="sera-sc-page">
      <SupplyChainPageHeader
        title="Inventory"
        description="Real-time inventory tracking across all locations"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={loading || exporting} className="border-[var(--sera-line)]">
              {exporting ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              {exporting ? 'Exporting...' : 'Export Excel'}
            </Button>
            {canEditSettings() && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onViewChange?.('inventory-settings')}
                className="border-[var(--sera-line)] text-[var(--sera-ink)] hover:border-[var(--sera-orange)]/40"
              >
                <Settings className="w-4 h-4 mr-2" />
                Inventory Settings
              </Button>
            )}
            <Button
              size="sm"
              className="bg-[var(--sera-ink)] text-white hover:bg-[var(--sera-ink-soft)]"
              onClick={() => onViewChange?.('stock-adjustment')}
            >
              <Package className="w-4 h-4 mr-2" />
              Stock Adjustment
            </Button>
          </>
        }
      />
      {exportMessage && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            exportMessage.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {exportMessage.text}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="sera-sc-kpi">
          <p className="sera-sc-kpi__label">Total Inventory Value</p>
          <p className="sera-sc-kpi__value text-[1.35rem] sm:text-[1.75rem] truncate">RM {formatCurrency(totalValue)}</p>
        </div>
        <div className="sera-sc-kpi">
          <p className="sera-sc-kpi__label">In Stock</p>
          <p className="sera-sc-kpi__value">{inStockPercentage}%</p>
          <p className="text-xs text-[var(--sera-muted)] hidden sm:block">{inStockItems} of {filteredInventory.length} items</p>
        </div>
        <div className="sera-sc-kpi">
          <p className="sera-sc-kpi__label">Low Stock</p>
          <p className="sera-sc-kpi__value">{lowStockItems}</p>
          {lowStockWithIncoming > 0 && (
            <p className="text-xs text-[var(--sera-orange)] hidden sm:block">{lowStockWithIncoming} with incoming replenishment</p>
          )}
        </div>
        <div className="sera-sc-kpi">
          <p className="sera-sc-kpi__label">Out of Stock</p>
          <p className="sera-sc-kpi__value">{outOfStockItems}</p>
        </div>
      </div>

      {/* Filters */}
      <Card className="sera-sc-panel shadow-none">
        <CardContent className="p-4 sm:p-6">
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--sera-muted)] w-5 h-5" />
              <Input
                placeholder="Search by product name, variant code, or location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 border-[var(--sera-line)] focus-visible:ring-[var(--sera-orange)]/30"
              />
            </div>

            {/* Filter Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="text-xs font-medium text-[var(--sera-ink)]/80 mb-1.5 block">Location</label>
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
                <label className="text-xs font-medium text-[var(--sera-ink)]/80 mb-1.5 block">Product Name</label>
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
                <label className="text-xs font-medium text-[var(--sera-ink)]/80 mb-1.5 block">Variant</label>
                <Select
                  value={variantFilter}
                  onValueChange={setVariantFilter}
                  disabled={productFilter === 'all'}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={productFilter === 'all' ? 'Select a product first' : 'All Variants'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Variants</SelectItem>
                    {filteredVariants.map((variant) => (
                      <SelectItem key={variant.variant_code} value={variant.variant_code}>
                        {variant.variant_code} - {variant.variant_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-[var(--sera-ink)]/80 mb-1.5 block">Stock Status</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="in_stock">Available</SelectItem>
                    <SelectItem value="low_stock">Low Stock</SelectItem>
                    <SelectItem value="out_of_stock">Not Available</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-[var(--sera-ink)]/80 mb-1.5 block">Value Range</label>
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
            {(searchQuery || locationFilter !== 'all' || statusFilter !== 'all' || productFilter !== 'all' || variantFilter !== 'all' || valueRangeFilter !== 'all') && (
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-[var(--sera-muted)]">Active filters:</span>
                  {searchQuery && <Badge variant="secondary">Search: {searchQuery}</Badge>}
                  {locationFilter !== 'all' && <Badge variant="secondary">Location</Badge>}
                  {productFilter !== 'all' && <Badge variant="secondary">Product</Badge>}
                  {variantFilter !== 'all' && <Badge variant="secondary">Variant</Badge>}
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
                    setVariantFilter('all')
                    setStatusFilter('all')
                    setValueRangeFilter('all')
                  }}
                  className="text-[var(--sera-muted)] hover:text-[var(--sera-ink)]"
                >
                  Clear All Filters
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Inventory Table */}
      <Card className="sera-sc-panel overflow-hidden shadow-none">
        <CardHeader>
          <CardTitle>Inventory Items</CardTitle>
          <CardDescription>
            {loading ? 'Loading...' : `${filteredInventory.length} inventory items found`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
          <Table className="min-w-[800px]">
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer hover:bg-[var(--sera-ink)]/[0.04] select-none"
                  onClick={() => handleSort('product_name')}
                >
                  <div className="flex items-center">
                    Product Name
                    {renderSortIcon('product_name')}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-[var(--sera-ink)]/[0.04] select-none"
                  onClick={() => handleSort('location')}
                >
                  <div className="flex items-center">
                    Location
                    {renderSortIcon('location')}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-[var(--sera-ink)]/[0.04] select-none"
                  onClick={() => handleSort('on_hand')}
                >
                  <div className="flex items-center">
                    On Hand
                    {renderSortIcon('on_hand')}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-[var(--sera-ink)]/[0.04] select-none"
                  onClick={() => handleSort('allocated')}
                >
                  <div className="flex items-center">
                    Allocated
                    {renderSortIcon('allocated')}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-[var(--sera-ink)]/[0.04] select-none"
                  onClick={() => handleSort('available')}
                >
                  <div className="flex items-center">
                    Available
                    {renderSortIcon('available')}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-[var(--sera-ink)]/[0.04] select-none"
                  onClick={() => handleSort('incoming')}
                >
                  <div className="flex items-center">
                    Incoming
                    {renderSortIcon('incoming')}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-[var(--sera-ink)]/[0.04] select-none"
                  onClick={() => handleSort('position')}
                >
                  <div className="flex items-center">
                    Position
                    {renderSortIcon('position')}
                  </div>
                </TableHead>
                <TableHead>Stock Level</TableHead>
                {canViewTotalValue() && (
                  <TableHead
                    className="cursor-pointer hover:bg-[var(--sera-ink)]/[0.04] select-none text-right"
                    onClick={() => handleSort('total_value')}
                  >
                    <div className="flex items-center justify-end">
                      Total Value
                      {renderSortIcon('total_value')}
                    </div>
                  </TableHead>
                )}
                {canEditSettings() && <TableHead className="text-center">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={canEditSettings() ? 10 : 9} className="text-center py-8">
                    Loading inventory...
                  </TableCell>
                </TableRow>
              ) : inventory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canEditSettings() ? 10 : 9} className="text-center py-8">
                    No inventory items found
                  </TableCell>
                </TableRow>
              ) : (
                paginatedInventory.map((item: InventoryItem) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <ProductThumbnail
                          src={item.variant_image_url ?? undefined}
                          alt={item.variant_name || item.product_name || 'Product'}
                          size={48}
                        />
                        <div>
                          <p className="text-xs font-medium">
                            {item.product_name || 'Unknown Product'}
                          </p>
                          <p className="text-xs text-[var(--sera-muted)]">
                            [{item.variant_name || 'No variant'}]
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-xs font-medium">{item.organization_name || 'Unknown Location'}</p>
                        {item.warehouse_location && (
                          <p className="text-xs text-[var(--sera-muted)]">{item.warehouse_location}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium">{formatNumber(item.quantity_on_hand)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-[var(--sera-muted)]">{formatNumber(item.quantity_allocated)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium">{formatNumber(item.quantity_available)}</span>
                    </TableCell>
                    <TableCell>
                      {getIncomingQty(item) > 0 ? (
                        <div>
                          <button
                            type="button"
                            onClick={() => setIncomingDetailItem(item)}
                            className="text-xs font-medium text-[var(--sera-orange)] underline decoration-dotted underline-offset-2 hover:text-[var(--sera-orange-deep)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sera-orange)]/30 focus-visible:ring-offset-1 rounded-sm"
                            title="View incoming orders and transfers"
                          >
                            {formatNumber(getIncomingQty(item))}
                          </button>
                          {(() => {
                            const breakdown = getItemIncomingBreakdown(item)
                            if (breakdown.transfer <= 0) return null
                            return (
                              <p className="text-xs text-[var(--sera-muted)]/80">
                                PO {formatNumber(breakdown.manufacturer)} · TRF {formatNumber(breakdown.transfer)}
                              </p>
                            )
                          })()}
                        </div>
                      ) : (
                        <span className="text-xs text-[var(--sera-muted)]/70">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium">
                        {formatNumber(item.quantity_available + getIncomingQty(item))}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {getStockLevelBadge(item.quantity_available, item.reorder_point)}
                          {getReplenishmentBadge(item.quantity_available, getIncomingQty(item), item.reorder_point)}
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${item.quantity_available === 0 ? 'bg-red-500' :
                              item.quantity_available <= item.reorder_point * 0.5 ? 'bg-red-500' :
                                item.quantity_available <= item.reorder_point ? 'bg-orange-500' : 'bg-green-500'
                              }`}
                            style={{
                              width: `${getStockPercentage(item.quantity_available, item.reorder_point)}%`
                            }}
                          />
                        </div>
                        <p className="text-xs text-[var(--sera-muted)]">
                          Reorder at: {formatNumber(item.reorder_point)}
                        </p>
                      </div>
                    </TableCell>
                    {canViewTotalValue() && (
                      <TableCell className="text-xs text-right">
                        <span className="font-medium">
                          RM {formatCurrency(item.total_value ?? 0)}
                        </span>
                        <p className="text-xs text-[var(--sera-muted)]">
                          @ RM {formatCurrency(item.unit_cost ?? 0)} per unit
                        </p>
                      </TableCell>
                    )}
                    {canEditSettings() && (
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenSettings(item)}
                          className="hover:bg-[var(--sera-orange)]/[0.06] hover:text-[var(--sera-orange)]"
                          title="Configure stock settings"
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>

          {/* Pagination */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[var(--sera-muted)] text-sm">
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
                className="bg-[var(--sera-orange)]/[0.06] text-[var(--sera-orange)] border-[var(--sera-orange)]/20"
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

      {/* Stock Settings Panel */}
      {settingsOpen && selectedItem && (
        <StockSettingsPanel
          inventoryItem={{
            id: selectedItem.id,
            variant_id: selectedItem.variant_id || '',
            variant_code: selectedItem.variant_code || 'N/A',
            variant_name: selectedItem.variant_name || 'Unknown',
            product_name: selectedItem.product_name || 'Unknown Product',
            organization_id: selectedItem.organization_id || '',
            organization_name: selectedItem.organization_name || 'Unknown Location',
            quantity_on_hand: selectedItem.quantity_on_hand,
            quantity_allocated: selectedItem.quantity_allocated,
            quantity_available: selectedItem.quantity_available,
            reorder_point: selectedItem.reorder_point,
            reorder_quantity: selectedItem.reorder_quantity,
            max_stock_level: selectedItem.max_stock_level || null,
            safety_stock: selectedItem.safety_stock || null,
            lead_time_days: selectedItem.lead_time_days || null,
            total_value: selectedItem.total_value,
            warehouse_location: selectedItem.warehouse_location
          }}
          incomingQty={getIncomingQty(selectedItem)}
          incomingBreakdown={getItemIncomingBreakdown(selectedItem)}
          onClose={handleCloseSettings}
          onSave={handleSaveSettings}
        />
      )}

      {/* Incoming Stock Detail Dialog */}
      {incomingDetailItem && (
        <IncomingStockDialog
          open={!!incomingDetailItem}
          onClose={() => setIncomingDetailItem(null)}
          variantId={incomingDetailItem.variant_id || ''}
          warehouseOrgId={incomingDetailItem.organization_id || ''}
          productName={incomingDetailItem.product_name || 'Product'}
          variantName={incomingDetailItem.variant_name || ''}
        />
      )}
    </div>
  )
}
