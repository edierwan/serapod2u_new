'use client'

import { Fragment, useState, useEffect, useMemo } from 'react'
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
  BarChart3,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Settings,
  ChevronDown
} from 'lucide-react'
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
import {
  aggregateVariantInventory,
  buildInventorySummaryExportRows,
  filterVariantInventorySummaries,
  paginateVariantInventorySummaries,
  sortVariantInventorySummaries,
  type InventorySummarySortColumn,
  type VariantInventorySummary
} from '@/lib/inventory/inventory-view-aggregation'
import {
  HQ_ALL_WAREHOUSES_LABEL,
  HQ_CONSOLIDATED_LEGACY_NOTE,
  hqConsolidatedLocationValue,
  hqIdFromConsolidatedLocation,
  isHqConsolidatedLocation,
  remapRowsForHqConsolidatedView,
} from '@/lib/inventory/hq-consolidated-location'

interface InventoryItem {
  id: string
  variant_id?: string | null
  variant_code?: string | null
  variant_name?: string | null
  variant_image_url?: string | null
  stock_config_id?: string | null
  config_code?: string | null
  config_label?: string | null
  stock_sku?: string | null
  volume_ml?: number | null
  packaging?: string | null
  default_for_ord?: boolean | null
  stock_config_status?: string | null
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
  const [hqWarehouseIdsByHq, setHqWarehouseIdsByHq] = useState<Map<string, string[]>>(new Map())
  const [products, setProducts] = useState<any[]>([])
  const [variants, setVariants] = useState<any[]>([])
  const [sortColumn, setSortColumn] = useState<InventorySummarySortColumn | null>('product_name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [incomingMap, setIncomingMap] = useState<Map<string, IncomingStockRow>>(new Map())
  const [incomingDetailItem, setIncomingDetailItem] = useState<Pick<
    InventoryItem,
    'variant_id' | 'organization_id' | 'product_name' | 'variant_name'
  > | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportMessage, setExportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set())

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
  }, [isReady, showInactive])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, locationFilter, statusFilter, productFilter, variantFilter, valueRangeFilter])

  const handleSort = (column: InventorySummarySortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
    setCurrentPage(1)
  }

  // Variant-level incoming (manufacturer + transfer). The aggregation attributes
  // this single quantity to exactly one configuration (20ml New Box) so it is
  // never repeated across configuration rows.
  const getVariantIncoming = (orgId?: string | null, variantId?: string | null): number =>
    incomingMap.get(incomingKey(orgId, variantId))?.incoming_qty ?? 0

  // Variant-wide identity filters are safe before aggregation because every
  // configuration shares them. Free-text search is deliberately applied after
  // aggregation: matching one Stock SKU must not produce a partial flavour total.
  const identityFilteredRows = useMemo(() => {
    const locationScoped = isHqConsolidatedLocation(locationFilter)
      ? remapRowsForHqConsolidatedView(
        inventory,
        hqWarehouseIdsByHq.get(hqIdFromConsolidatedLocation(locationFilter)) || [],
        locationFilter,
      )
      : inventory.filter(item => locationFilter === 'all' || item.organization_id === locationFilter)

    return locationScoped.filter(item => {
      const matchesProduct = productFilter === 'all' || item.product_name === productFilter
      const matchesVariant = variantFilter === 'all' || item.variant_code === variantFilter
      return matchesProduct && matchesVariant
    })
  }, [inventory, locationFilter, productFilter, variantFilter, hqWarehouseIdsByHq])

  // One authoritative summary per organization + variant. Four Banana balance
  // rows collapse to a single row; incoming appears once; value is positive.
  const allSummaries = useMemo(
    () => aggregateVariantInventory(identityFilteredRows, getVariantIncoming, { includeInactive: showInactive }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identityFilteredRows, incomingMap, showInactive]
  )

  const filteredSummaries = useMemo(() => {
    return filterVariantInventorySummaries(allSummaries, {
      searchQuery,
      statusFilter: statusFilter as 'all' | 'low_stock' | 'out_of_stock' | 'in_stock',
      valueRangeFilter: valueRangeFilter as 'all' | 'under_1000' | '1000_5000' | '5000_10000' | 'over_10000',
    })
  }, [allSummaries, searchQuery, statusFilter, valueRangeFilter])

  const sortedSummaries = useMemo(
    () => sortVariantInventorySummaries(filteredSummaries, sortColumn, sortDirection),
    [filteredSummaries, sortColumn, sortDirection]
  )

  const paginatedSummaries = useMemo(
    () => paginateVariantInventorySummaries(sortedSummaries, currentPage, itemsPerPage),
    [sortedSummaries, currentPage, itemsPerPage]
  )

  // Look up the underlying balance row for the per-configuration settings action.
  const inventoryById = useMemo(
    () => new Map(inventory.map(item => [item.id, item])),
    [inventory]
  )

  const renderSortIcon = (column: InventorySummarySortColumn) => {
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
    const exportRows = buildInventorySummaryExportRows(sortedSummaries)

    if (!canExport) {
      setExportMessage({ type: 'error', text: 'You do not have permission to export inventory.' })
      toast({
        title: 'Export unavailable',
        description: 'You do not have permission to export inventory.',
        variant: 'destructive'
      })
      return
    }

    if (exportRows.length === 0) {
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

      exportRows.forEach((summary, index) => {
        const location = [summary.organizationName, summary.warehouseLocation]
          .filter((value, position, values) => value && values.indexOf(value) === position)
          .join(' — ') || '-'
        const updatedAt = summary.updatedAt ? new Date(summary.updatedAt) : null
        const validUpdatedAt = updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : '-'
        const decision = getReplenishmentDecision(summary.available, summary.incoming, summary.reorderPoint)

        worksheet.addRow([
          index + 1,
          summary.productName || '-',
          summary.productCode || '-',
          summary.variantName || '-',
          summary.variantCode || '-',
          location,
          summary.onHand,
          summary.allocated,
          summary.available,
          summary.incoming,
          decision.inventoryPosition,
          getStockStatus(summary.available, summary.reorderPoint),
          decision.label,
          summary.reorderPoint,
          canViewCost ? (summary.unitCost ?? '-') : '-',
          canViewValue ? (summary.value ?? '-') : '-',
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

      setExportMessage({ type: 'success', text: `Downloaded ${exportRows.length} inventory row(s).` })
      toast({
        title: 'Export ready',
        description: `Downloaded ${exportRows.length} inventory row(s).`,
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
    if (item.default_for_ord === false) return undefined
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

      const viewResult: { data: any[] | null; error: any } = showInactive
        ? { data: null, error: { code: 'PGRST204', message: 'Show inactive requires base inventory rows' } }
        : await fetchAllPages(() => {
        return supabase
          .from('vw_inventory_on_hand' as any)
          .select('*')
          .order('organization_id')
          .order('variant_id')
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
          return supabase
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
            stock_config_id,
            inventory_stock_configurations!product_inventory_stock_config_fk (
              config_code,
              config_label,
              stock_sku,
              volume_ml,
              packaging,
              status,
              default_for_ord
            ),
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
            .select('variant_id, stock_config_id, to_organization_id, quantity_change, movement_type')
            .in('variant_id', collectedVariantIds as string[])
            .in('to_organization_id', organizationIds as string[])
            .ilike('movement_type', 'warranty_bonus')

          if (!warrantyError && warrantyMovements) {
            warrantyMovements.forEach((movement: any) => {
              if (movement.to_organization_id && movement.variant_id) {
                const key = `${movement.to_organization_id}:${movement.variant_id}:${movement.stock_config_id || 'legacy'}`
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
            const key = organizationId && variantId ? `${organizationId}:${variantId}:${item.stock_config_id || 'legacy'}` : null
            const warrantyBonusQty = key ? (warrantyBonusMap.get(key) ?? 0) : 0
            // Inventory value is a current-balance measure: On Hand × cost. It
            // must never go negative just because a warranty bonus or a
            // classification-out movement exceeds the remaining balance.
            const valuableQty = Math.max(0, quantityOnHand - warrantyBonusQty)
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
          stock_config_id: item.stock_config_id ?? null,
          config_code: item.config_code ?? item.inventory_stock_configurations?.config_code ?? null,
          config_label: item.config_label ?? item.inventory_stock_configurations?.config_label ?? null,
          stock_sku: item.stock_sku ?? item.inventory_stock_configurations?.stock_sku ?? null,
          volume_ml: parseNumber(item.volume_ml ?? item.inventory_stock_configurations?.volume_ml),
          packaging: item.packaging ?? item.inventory_stock_configurations?.packaging ?? null,
          default_for_ord: item.default_for_ord ?? item.inventory_stock_configurations?.default_for_ord ?? null,
          stock_config_status: item.stock_config_status ?? item.inventory_stock_configurations?.status ?? null,
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
            .select('warehouse_id, variant_id, stock_config_id, manual_balance_qty')
            .in('variant_id', variantIds)
            .in('warehouse_id', organizationIds)

          if (!manualViewError) {
            manualViewData?.forEach((row: any) => {
              if (!row?.warehouse_id || !row?.variant_id) return
              const key = `${row.warehouse_id}:${row.variant_id}:${row.stock_config_id || 'legacy'}`
              manualBalanceMap.set(key, Number(row.manual_balance_qty ?? 0))
            })
          } else {
            console.warn('vw_manual_stock_balance unavailable, aggregating manual balance from stock_movements', manualViewError)
            const { data: manualMovementData, error: manualMovementError } = await supabase
              .from('stock_movements')
              .select('variant_id, stock_config_id, movement_type, to_organization_id, from_organization_id, quantity_change')
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

                const key = `${targetOrg}:${movement.variant_id}:${movement.stock_config_id || 'legacy'}`
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
              const key = `${item.organization_id}:${item.variant_id}:${item.stock_config_id || 'legacy'}`
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
              .select('variant_id, stock_config_id, quantity_change, from_organization_id, to_organization_id, movement_type')
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
                  const key = `${toOrg}:${variantId}:${movement.stock_config_id || 'legacy'}`
                  movementTotalsMap.set(key, (movementTotalsMap.get(key) ?? 0) + qty)

                  // Track warranty_bonus quantities
                  const movementType = movement.movement_type ? movement.movement_type.toLowerCase().trim() : ''
                  if (movementType === 'warranty_bonus') {
                    warrantyBonusMap.set(key, (warrantyBonusMap.get(key) ?? 0) + qty)
                  }
                }

                const fromOrg = movement.from_organization_id
                if (fromOrg && organizationIdSet.has(fromOrg)) {
                  const key = `${fromOrg}:${variantId}:${movement.stock_config_id || 'legacy'}`
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

              const key = `${item.organization_id}:${item.variant_id}:${item.stock_config_id || 'legacy'}`
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

              // Exclude warranty_bonus quantities from value calculation, but
              // never let the valued quantity go negative — inventory value is a
              // current-balance measure, not a movement variance.
              const warrantyBonusQty = warrantyBonusMap.get(key) ?? 0
              const valuableQty = Math.max(0, recalculatedOnHand - warrantyBonusQty)

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

      if (showInactive && collectedVariantIds.length > 0) {
        const { data: allConfigs } = await supabase.from('inventory_stock_configurations')
          .select('id, variant_id, config_code, config_label, stock_sku, volume_ml, packaging, status, default_for_ord')
          .in('variant_id', collectedVariantIds as string[])
          .order('sort_order')
        const present = new Set(normalized.map(row => `${row.organization_id}:${row.variant_id}:${row.stock_config_id}`))
        const contexts = new Map<string, InventoryItem>(
          normalized.filter(row => row.organization_id && row.variant_id).map(row => [`${row.organization_id}:${row.variant_id}`, row]),
        )
        for (const context of contexts.values()) {
          for (const config of (allConfigs || []).filter((candidate: any) => candidate.variant_id === context.variant_id)) {
            const key = `${context.organization_id}:${context.variant_id}:${config.id}`
            if (present.has(key)) continue
            normalized.push({
              ...context,
              id: `zero-${key}`,
              stock_config_id: config.id,
              config_code: config.config_code,
              config_label: config.config_label,
              stock_sku: config.stock_sku,
              volume_ml: config.volume_ml,
              packaging: config.packaging,
              stock_config_status: config.status,
              default_for_ord: config.default_for_ord,
              quantity_on_hand: 0,
              quantity_allocated: 0,
              quantity_available: 0,
              total_value: 0,
              manual_balance_qty: 0,
            })
          }
        }
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
        .select('id, org_name, org_code, org_type_code, parent_org_id')
        .in('org_type_code', ['WH', 'HQ'])
        .eq('is_active', true)
        .order('org_name')

      if (error) throw error

      const rows = data || []
      const hqRows = rows.filter((row: any) => row.org_type_code === 'HQ')
      const warehouseRows = rows.filter((row: any) => row.org_type_code === 'WH')
      const warehouseIdsByHq = new Map<string, string[]>()
      for (const warehouse of warehouseRows) {
        if (!warehouse.parent_org_id) continue
        const current = warehouseIdsByHq.get(warehouse.parent_org_id) || []
        current.push(warehouse.id)
        warehouseIdsByHq.set(warehouse.parent_org_id, current)
      }
      setHqWarehouseIdsByHq(warehouseIdsByHq)

      const consolidatedOptions = hqRows
        .filter((hq: any) => (warehouseIdsByHq.get(hq.id) || []).length > 0)
        .map((hq: any) => ({
          id: hqConsolidatedLocationValue(hq.id),
          org_name: HQ_ALL_WAREHOUSES_LABEL,
          org_code: 'HQ-ALL-WH',
          is_consolidated: true,
        }))

      // Keep individual warehouse/HQ filters; append display-only consolidated option(s).
      setLocations([...rows.map((row: any) => ({
        id: row.id,
        org_name: row.org_name,
        org_code: row.org_code,
        is_consolidated: false,
      })), ...consolidatedOptions])
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
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Replenishment Incoming</Badge>
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

  // Calculate stats from the aggregated summaries (one entry per flavour), so
  // counts and value are never inflated by configuration join rows.
  const totalValue = filteredSummaries.reduce((sum, summary) => sum + (summary.value ?? 0), 0)
  const inStockItems = filteredSummaries.filter(summary => summary.available > 0).length
  const lowStockItems = filteredSummaries.filter(summary => summary.available <= summary.reorderPoint && summary.available > 0).length
  const lowStockWithIncoming = filteredSummaries.filter(summary =>
    summary.available <= summary.reorderPoint && summary.incoming > 0
  ).length
  const outOfStockItems = filteredSummaries.filter(summary => summary.available <= 0).length
  const inStockPercentage = filteredSummaries.length > 0 ? Math.round((inStockItems / filteredSummaries.length) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-gray-600">Real-time inventory tracking across all locations</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={loading || exporting}>
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
              className="border-blue-600 text-blue-600 hover:bg-blue-50"
            >
              <Settings className="w-4 h-4 mr-2" />
              Inventory Settings
            </Button>
          )}
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => onViewChange?.('stock-adjustment')}>
            <Package className="w-4 h-4 mr-2" />
            Stock Adjustment
          </Button>
        </div>
      </div>
      {exportMessage && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            exportMessage.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {exportMessage.text}
        </div>
      )}

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
            <p className="text-xs text-gray-600 hidden sm:block">{inStockItems} of {filteredSummaries.length} items</p>
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
            {lowStockWithIncoming > 0 && (
              <p className="text-xs text-blue-600 hidden sm:block">{lowStockWithIncoming} with incoming replenishment</p>
            )}
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
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
                        {location.is_consolidated ? ' (consolidated)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isHqConsolidatedLocation(locationFilter) && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    {HQ_CONSOLIDATED_LEGACY_NOTE}
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium text-gray-700 mb-1.5 block">Product Name</label>
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
                <label className="text-xs font-medium text-gray-700 mb-1.5 block">Variant</label>
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
                <label className="text-xs font-medium text-gray-700 mb-1.5 block">Stock Status</label>
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
            {(searchQuery || locationFilter !== 'all' || statusFilter !== 'all' || productFilter !== 'all' || variantFilter !== 'all' || valueRangeFilter !== 'all') && (
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-600">Active filters:</span>
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
                  className="text-gray-600 hover:text-gray-900"
                >
                  Clear All Filters
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Inventory Table — one aggregate row per organization + variant.
          Each flavour total is calculated once from its configuration rows;
          expand a row to inspect the physical Stock SKUs (Aggregate variant
          total). Incoming appears once and value is a positive current balance. */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Inventory Items</CardTitle>
              <CardDescription>
                {loading ? 'Loading...' : `${filteredSummaries.length} flavour summar${filteredSummaries.length === 1 ? 'y' : 'ies'} found`}
              </CardDescription>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showInactive} onChange={event => setShowInactive(event.target.checked)} />
              Show inactive zero-balance configurations
            </label>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
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
                <TableHead
                  className="cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('incoming')}
                >
                  <div className="flex items-center">
                    Incoming
                    {renderSortIcon('incoming')}
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-gray-100 select-none"
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
                    className="cursor-pointer hover:bg-gray-100 select-none text-right"
                    onClick={() => handleSort('total_value')}
                  >
                    <div className="flex items-center justify-end">
                      Total Value
                      {renderSortIcon('total_value')}
                    </div>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={canViewTotalValue() ? 9 : 8} className="text-center py-8">
                    Loading inventory...
                  </TableCell>
                </TableRow>
              ) : filteredSummaries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canViewTotalValue() ? 9 : 8} className="text-center py-8">
                    No inventory items found
                  </TableCell>
                </TableRow>
              ) : (
                paginatedSummaries.map((summary: VariantInventorySummary) => {
                  const expanded = expandedVariants.has(summary.key)
                  const incomingBreakdown = getIncomingBreakdown(
                    incomingMap.get(incomingKey(summary.organizationId, summary.variantId))
                  )
                  const toggleExpanded = () => setExpandedVariants(current => {
                    const next = new Set(current)
                    next.has(summary.key) ? next.delete(summary.key) : next.add(summary.key)
                    return next
                  })
                  return (
                  <Fragment key={summary.key}>
                  <TableRow className="cursor-pointer" onClick={toggleExpanded}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); toggleExpanded() }}
                          className="text-gray-400 hover:text-gray-700 focus:outline-none"
                          aria-label={expanded ? 'Collapse configurations' : 'Expand configurations'}
                        >
                          <ChevronDown className={`h-4 w-4 transition ${expanded ? '' : '-rotate-90'}`} />
                        </button>
                        <ProductThumbnail
                          src={summary.variantImageUrl ?? undefined}
                          alt={summary.variantName || summary.productName || 'Product'}
                          size={48}
                        />
                        <div>
                          <p className="text-xs font-medium">
                            {summary.productName || 'Unknown Product'}
                          </p>
                          <p className="text-xs text-gray-600">
                            [{summary.variantName || 'No variant'}]
                          </p>
                          <p className="text-xs text-gray-500">
                            {summary.configs.length + summary.hiddenConfigCount} configuration{(summary.configs.length + summary.hiddenConfigCount) === 1 ? '' : 's'} · Aggregate variant total
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-xs font-medium">{summary.organizationName || 'Unknown Location'}</p>
                        {summary.warehouseLocation && (
                          <p className="text-xs text-gray-600">{summary.warehouseLocation}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium">{formatNumber(summary.onHand)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-gray-600">{formatNumber(summary.allocated)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium">{formatNumber(summary.available)}</span>
                    </TableCell>
                    <TableCell>
                      {summary.incoming > 0 ? (
                        <div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setIncomingDetailItem({
                                variant_id: summary.variantId,
                                organization_id: summary.organizationId,
                                product_name: summary.productName,
                                variant_name: summary.variantName,
                              })
                            }}
                            className="text-xs font-medium text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 rounded-sm"
                            title="View incoming orders and transfers"
                          >
                            {formatNumber(summary.incoming)}
                          </button>
                          {incomingBreakdown.transfer > 0 && (
                            <p className="text-xs text-gray-500">
                              PO {formatNumber(incomingBreakdown.manufacturer)} · TRF {formatNumber(incomingBreakdown.transfer)}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium">
                        {formatNumber(summary.position)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {getStockLevelBadge(summary.available, summary.reorderPoint)}
                          {getReplenishmentBadge(summary.available, summary.incoming, summary.reorderPoint)}
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${summary.available === 0 ? 'bg-red-500' :
                              summary.available <= summary.reorderPoint * 0.5 ? 'bg-red-500' :
                                summary.available <= summary.reorderPoint ? 'bg-orange-500' : 'bg-green-500'
                              }`}
                            style={{
                              width: `${getStockPercentage(summary.available, summary.reorderPoint)}%`
                            }}
                          />
                        </div>
                        <p className="text-xs text-gray-600">
                          Reorder at: {formatNumber(summary.reorderPoint)}
                        </p>
                      </div>
                    </TableCell>
                    {canViewTotalValue() && (
                      <TableCell className="text-xs text-right">
                        <span className="font-medium">
                          RM {formatCurrency(summary.value ?? 0)}
                        </span>
                        <p className="text-xs text-gray-600">
                          @ RM {formatCurrency(summary.unitCost ?? 0)} per unit
                        </p>
                      </TableCell>
                    )}
                  </TableRow>
                  {expanded && (
                    <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
                      <TableCell colSpan={canViewTotalValue() ? 9 : 8} className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-4 py-2 text-left">Stock SKU</th>
                                <th className="px-4 py-2 text-left">Volume / Packaging</th>
                                <th className="px-4 py-2 text-left">Lifecycle</th>
                                <th className="px-4 py-2 text-right">On Hand</th>
                                <th className="px-4 py-2 text-right">Incoming</th>
                                <th className="px-4 py-2 text-right">Position</th>
                                {canViewTotalValue() && <th className="px-4 py-2 text-right">Value</th>}
                                {canEditSettings() && <th className="px-4 py-2 text-center">Actions</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {summary.configs.map((config) => (
                                <tr key={config.id} className="border-t border-slate-200">
                                  <td className="px-4 py-2 font-mono text-blue-700">{config.stockSku || 'Legacy'}</td>
                                  <td className="px-4 py-2">
                                    {config.isLegacy ? (
                                      <span className="text-amber-700">Legacy / Unclassified</span>
                                    ) : (
                                      <span>
                                        {config.volumeMl ? `${config.volumeMl}ml` : '—'}
                                        {config.packaging ? ` · ${config.packaging === 'new_box' ? 'New Box' : config.packaging === 'old_box' ? 'Old Box' : config.packaging}` : ''}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2">
                                    <Badge variant="outline">{config.lifecycleStatus || 'active'}</Badge>
                                  </td>
                                  <td className="px-4 py-2 text-right font-medium">{formatNumber(config.onHand)}</td>
                                  <td className="px-4 py-2 text-right">{config.incoming > 0 ? formatNumber(config.incoming) : <span className="text-gray-400">0</span>}</td>
                                  <td className="px-4 py-2 text-right">{formatNumber(config.position)}</td>
                                  {canViewTotalValue() && (
                                    <td className="px-4 py-2 text-right">RM {formatCurrency(config.value)}</td>
                                  )}
                                  {canEditSettings() && (
                                    <td className="px-4 py-2 text-center">
                                      {(() => {
                                        const row = inventoryById.get(config.id)
                                        if (!row) return null
                                        return (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={(event) => { event.stopPropagation(); handleOpenSettings(row) }}
                                            className="hover:bg-blue-50 hover:text-blue-600"
                                            title="Configure stock settings"
                                          >
                                            <Settings className="h-4 w-4" />
                                          </Button>
                                        )
                                      })()}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                  )
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-gray-600 text-sm">
              {filteredSummaries.length === 0
                ? 'No items to display'
                : `Showing ${(currentPage - 1) * itemsPerPage + 1} to ${Math.min(currentPage * itemsPerPage, filteredSummaries.length)} of ${filteredSummaries.length} items`}
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
                disabled={currentPage * itemsPerPage >= filteredSummaries.length}
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
