'use client'

// Build: 2025-11-28 - Fix useMemo reference error
import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Scan,
  QrCode,
  CheckCircle,
  Trash2,
  RefreshCw,
  History,
  TrendingUp,
  Box,
  Target,
  Truck,
  AlertTriangle,
  ClipboardPaste,
  Unlink,
  XCircle,
  Search,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string
  organizations: {
    id: string
    org_name: string
    org_type_code: string
  }
}

interface WarehouseShipV2Props {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

type HistoryPreset = 'today' | 'last7' | 'last30' | 'all'

interface IntakeHistoryRow {
  orderId: string
  orderNo: string
  buyerOrgName: string | null
  sellerOrgName: string | null // NEW: Seller organization name
  casesReceived: number
  unitsReceived: number
  casesScanned: number
  unitsScanned: number
  casesShipped: number
  unitsShipped: number
  firstReceivedAt: string | null
  lastReceivedAt: string | null
}

type HistorySortColumn = 'orderNo' | 'buyerOrgName' | 'sellerOrgName' | 'casesReceived' | 'unitsReceived' | 'casesScanned' | 'unitsScanned' | 'casesShipped' | 'unitsShipped' | 'firstReceivedAt' | 'lastReceivedAt'
type SortDirection = 'asc' | 'desc'

const HISTORY_PRESETS: Array<{ value: HistoryPreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'all', label: 'All time' }
]

const buildPresetRange = (preset: HistoryPreset) => {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date(end)

  switch (preset) {
    case 'today':
      start.setHours(0, 0, 0, 0)
      break
    case 'last7':
      start.setDate(start.getDate() - 6)
      start.setHours(0, 0, 0, 0)
      break
    case 'last30':
      start.setDate(start.getDate() - 29)
      start.setHours(0, 0, 0, 0)
      break
    case 'all':
      // Go back 10 years for "all time"
      start.setFullYear(start.getFullYear() - 10)
      start.setHours(0, 0, 0, 0)
      break
    default:
      start.setDate(start.getDate() - 29)
      start.setHours(0, 0, 0, 0)
      break
  }

  return { start, end }
}

const formatDateTime = (value: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

const formatDateOnly = (date: Date) =>
  date.toLocaleDateString(undefined, {
    dateStyle: 'medium'
  })

const formatNumber = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 })


interface ShipmentProgress {
  distributor_id: string
  distributor_name: string
  master_cases_scanned: number
  unique_codes_scanned: number
  total_expected_cases?: number
  total_expected_units?: number
  progress_percentage: number
  created_at: string
}

interface PendingUniqueCode {
  code: string
  product_name: string
  variant_name: string
}

interface ScanHistory {
  id: string
  distributor_id: string | null
  distributor_name: string
  master_code: string
  product_name?: string  // NEW: Product name for display
  case_number: number
  actual_unit_count: number
  scanned_at: string
  order_id: string | null
  order_no: string
  status: string  // Code status: 'warehouse_packed' or 'shipped_distributor'
  validation_status?: string  // Session status: 'pending', 'matched', 'approved'
  product_breakdown: Record<string, number>
  product_images?: Record<string, string | null>
  pending_master_codes?: string[]
  pending_unique_codes?: PendingUniqueCode[]
}

type ScanCodeType = 'master' | 'unique' | 'unknown'

interface ScannedProduct {
  code: string
  product_name: string
  variant_name: string
  image_url?: string | null
  sequence_number: number
  status: 'success' | 'duplicate' | 'error'
  error_message?: string
  code_type: ScanCodeType
}

export default function WarehouseShipV2({ userProfile }: WarehouseShipV2Props) {
  const [scannedCodes, setScannedCodes] = useState<ScannedProduct[]>([])
  const [qrInput, setQrInput] = useState('')
  const [scanning, setScanning] = useState(false)
  const [selectedDistributor, setSelectedDistributor] = useState<string>('')
  const [distributors, setDistributors] = useState<any[]>([])
  const [shipmentProgress, setShipmentProgress] = useState<ShipmentProgress | null>(null)
  const [distributorHistory, setDistributorHistory] = useState<ScanHistory[]>([])
  const [overallHistory, setOverallHistory] = useState<ScanHistory[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [showBatchInput, setShowBatchInput] = useState(false)
  const [batchInput, setBatchInput] = useState('')
  const [batchProcessingActive, setBatchProcessingActive] = useState(false)
  const [batchProcessingProgress, setBatchProcessingProgress] = useState(0)
  const [batchProcessingStatus, setBatchProcessingStatus] = useState('')
  const [batchProcessingSummary, setBatchProcessingSummary] = useState({ total: 0, success: 0, duplicates: 0, errors: 0 })
  const [confirming, setConfirming] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [unlinking, setUnlinking] = useState<string | null>(null)
  const [sessionQuantities, setSessionQuantities] = useState({
    total_units: 0,
    total_cases: 0,
    per_variant: {} as Record<string, { units: number; cases: number }>
  })
  
  // Manual stock state
  const [selectedVariant, setSelectedVariant] = useState<string>('')
  const [variants, setVariants] = useState<any[]>([])
  const [variantsWithStock, setVariantsWithStock] = useState<any[]>([])
  const [variantSearchTerm, setVariantSearchTerm] = useState<string>('')
  const [manualStockBalance, setManualStockBalance] = useState<number>(0)
  const [manualQty, setManualQty] = useState<number>(0)
  const [loadingManualStock, setLoadingManualStock] = useState(false)
  const [loadingVariants, setLoadingVariants] = useState(false)
  const [detailedStats, setDetailedStats] = useState({
    masterQrCount: 0,
    masterTotalUnits: 0,
    uniqueQrCount: 0,
    uniqueQrOverlap: 0,
    uniqueQrValid: 0,
    finalTotal: 0
  })
  
  // Pagination state
  const [distributorHistoryPage, setDistributorHistoryPage] = useState(1)
  const [overallHistoryPage, setOverallHistoryPage] = useState(1)
  const ITEMS_PER_PAGE = 5

  // Sorting state for Overall History
  const [overallSortColumn, setOverallSortColumn] = useState<string>('lastScanned')
  const [overallSortDirection, setOverallSortDirection] = useState<SortDirection>('desc')

  // Filters for Overall History
  const [overallFilterOrderNo, setOverallFilterOrderNo] = useState('')
  const [overallFilterDistributor, setOverallFilterDistributor] = useState('')
  const [overallFilterProduct, setOverallFilterProduct] = useState('')
  const [overallFilterDate, setOverallFilterDate] = useState('') // MMYY

  // Sorting state for Distributor History
  const [distributorSortColumn, setDistributorSortColumn] = useState<string>('lastScanned')
  const [distributorSortDirection, setDistributorSortDirection] = useState<SortDirection>('desc')
  
  const { toast } = useToast()
  const supabase = createClient()

  // Intake History State
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyRows, setHistoryRows] = useState<IntakeHistoryRow[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(10)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyTotalPages, setHistoryTotalPages] = useState(1)
  const [historyPreset, setHistoryPreset] = useState<HistoryPreset>('last30')
  const historyRange = useMemo(() => buildPresetRange(historyPreset), [historyPreset])
  const [historySearchInput, setHistorySearchInput] = useState('')
  const [historySearch, setHistorySearch] = useState('')
  const [historySortColumn, setHistorySortColumn] = useState<HistorySortColumn>('lastReceivedAt')
  const [historySortDirection, setHistorySortDirection] = useState<SortDirection>('desc')
  const historyRangeParams = useMemo(() => ({
    start: historyRange.start.toISOString(),
    end: historyRange.end.toISOString()
  }), [historyRange])
  const historySummary = useMemo(() => {
    return historyRows.reduce(
      (acc, row) => {
        acc.cases += row.casesReceived
        acc.units += row.unitsReceived
        return acc
      },
      { cases: 0, units: 0 }
    )
  }, [historyRows])

  useEffect(() => {
    const timeout = setTimeout(() => {
      setHistorySearch(historySearchInput)
      setHistoryPage(1)
    }, 350)

    return () => clearTimeout(timeout)
  }, [historySearchInput])

  useEffect(() => {
    loadIntakeHistory()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyPage, historyRangeParams.start, historyRangeParams.end, historySearch, historyPageSize])

  const loadIntakeHistory = async (pageOverride?: number, options?: { silent?: boolean }) => {
    const nextPage = pageOverride ?? historyPage
    try {
      if (!options?.silent) {
        setHistoryLoading(true)
      }

      const params = new URLSearchParams({
        warehouse_org_id: userProfile.organization_id,
        page: String(nextPage),
        pageSize: String(historyPageSize),
        start: historyRangeParams.start,
        end: historyRangeParams.end
      })

      if (historySearch) {
        params.set('search', historySearch)
      }

      const response = await fetch(`/api/warehouse/intake-history?${params.toString()}`)

      if (!response.ok) {
        let message = 'Failed to load intake history'
        try {
          const payload = await response.json()
          message = payload?.error || message
        } catch (parseError) {
          console.error('Failed to parse intake history error payload', parseError)
        }
        throw new Error(message)
      }

      const payload = await response.json()
      const rows: IntakeHistoryRow[] = Array.isArray(payload?.data) ? payload.data : []
      const total = typeof payload?.pageInfo?.total === 'number' ? payload.pageInfo.total : rows.length
      const totalPages = Math.max(
        typeof payload?.pageInfo?.totalPages === 'number'
          ? payload.pageInfo.totalPages
          : Math.ceil(total / historyPageSize) || 1,
        1
      )
      const resolvedPage = typeof payload?.pageInfo?.page === 'number' ? payload.pageInfo.page : nextPage

      setHistoryRows(rows)
      setHistoryTotal(total)
      setHistoryTotalPages(totalPages)
      setHistoryPage(Math.min(Math.max(resolvedPage, 1), totalPages))
      setHistoryError(null)
    } catch (error: any) {
      console.error('Error loading intake history:', error)
      setHistoryError(error?.message || 'Unable to load intake history')
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleHistorySort = (column: HistorySortColumn) => {
    if (historySortColumn === column) {
      // Toggle direction if same column
      setHistorySortDirection(historySortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // New column, default to descending for numbers/dates, ascending for text
      setHistorySortColumn(column)
      setHistorySortDirection(
        column === 'orderNo' || column === 'buyerOrgName' || column === 'sellerOrgName' ? 'asc' : 'desc'
      )
    }
  }

  const getSortIcon = (column: HistorySortColumn) => {
    if (historySortColumn !== column) {
      return <ArrowUpDown className="h-3 w-3 ml-1 text-gray-400" />
    }
    return historySortDirection === 'asc' ? (
      <ArrowUp className="h-3 w-3 ml-1 text-indigo-600" />
    ) : (
      <ArrowDown className="h-3 w-3 ml-1 text-indigo-600" />
    )
  }

  const sortedHistoryRows = useMemo(() => {
    const sorted = [...historyRows].sort((a, b) => {
      let aValue: any = a[historySortColumn]
      let bValue: any = b[historySortColumn]

      // Handle null values
      if (aValue === null && bValue === null) return 0
      if (aValue === null) return 1
      if (bValue === null) return -1

      // Handle different types
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase()
        bValue = bValue.toLowerCase()
      }

      if (aValue < bValue) return historySortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return historySortDirection === 'asc' ? 1 : -1
      return 0
    })
    return sorted
  }, [historyRows, historySortColumn, historySortDirection])

  const historyPageStart = (historyPage - 1) * historyPageSize + 1
  const historyPageEnd = Math.min(historyPage * historyPageSize, historyTotal)

  useEffect(() => {
    loadDistributors()
    loadVariants()
    loadScanHistory()
  }, [])

  useEffect(() => {
    if (selectedDistributor) {
      createOrLoadSession(selectedDistributor)
      loadScanHistory()
      loadVariants() // Refresh variants when distributor changes
    } else {
      setSessionId(null)
      setShipmentProgress(null)
      setDistributorHistory([])
      setScannedCodes([])
      setSessionQuantities({ total_units: 0, total_cases: 0, per_variant: {} })
    }
  }, [selectedDistributor])

  useEffect(() => {
    if (selectedDistributor) {
      setDistributorHistory(overallHistory.filter(item => item.distributor_id === selectedDistributor))
    } else {
      setDistributorHistory([])
    }
  }, [overallHistory, selectedDistributor])

  useEffect(() => {
    if (selectedVariant) {
      loadManualStockBalance(selectedVariant)
    } else {
      setManualStockBalance(0)
      setManualQty(0)
    }
  }, [selectedVariant])

  const loadDistributors = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_name, org_type_code')
        .eq('org_type_code', 'DIST')
        .eq('is_active', true)
        .order('org_name', { ascending: true })

      if (error) throw error
      setDistributors(data || [])
    } catch (error: any) {
      console.error('Error loading distributors:', error)
      toast({
        title: 'Error',
        description: 'Failed to load distributors',
        variant: 'destructive'
      })
    }
  }

  const loadVariants = async () => {
    try {
      setLoadingVariants(true)
      
      // Get variants with manual stock balance for this warehouse
      const { data: stockData, error: stockError } = await supabase
        .from('vw_manual_stock_balance')
        .select(`
          variant_id,
          manual_balance_qty,
          product_variants (
            id,
            variant_code,
            variant_name,
            products (
              product_name
            )
          )
        `)
        .eq('warehouse_id', userProfile.organization_id)
        .gt('manual_balance_qty', 0)
        .order('manual_balance_qty', { ascending: false })

      if (stockError) {
        console.error('Stock query error:', stockError)
        // Set empty arrays to stop loading state
        setVariantsWithStock([])
        setVariants([])
        throw stockError
      }
      
      // Transform data to include balance info
      const variantsData = (stockData || []).map(item => {
        const variant = item.product_variants
        return {
          ...variant,
          manual_balance_qty: item.manual_balance_qty
        }
      }).filter(v => v.id) // Filter out any null variants
      
      setVariantsWithStock(variantsData)
      setVariants(variantsData)
    } catch (error: any) {
      console.error('Error loading variants:', error)
      // Ensure arrays are set to empty on error
      setVariantsWithStock([])
      setVariants([])
      toast({
        title: 'Error',
        description: 'Failed to load product variants with stock',
        variant: 'destructive'
      })
    } finally {
      setLoadingVariants(false)
    }
  }

  const loadManualStockBalance = async (variantId: string) => {
    if (!variantId) {
      setManualStockBalance(0)
      return
    }

    try {
      setLoadingManualStock(true)
      const { data, error } = await supabase
        .from('vw_manual_stock_balance')
        .select('manual_balance_qty')
        .eq('warehouse_id', userProfile.organization_id)
        .eq('variant_id', variantId)
        .maybeSingle()

      if (error) throw error
      
      setManualStockBalance(data?.manual_balance_qty || 0)
    } catch (error: any) {
      console.error('Error loading manual stock balance:', error)
      setManualStockBalance(0)
    } finally {
      setLoadingManualStock(false)
    }
  }

  const createOrLoadSession = async (distributorId: string) => {
    try {
      console.log('🔍 Creating or loading session for distributor:', distributorId)

      // Check for existing session (pending or matched status means warehouse_packed items ready to ship)
      const { data: existingSession, error: sessionError } = await supabase
        .from('qr_validation_reports')
        .select('id, scanned_quantities, master_codes_scanned, unique_codes_scanned, distributor_org_id, validation_status')
        .eq('warehouse_org_id', userProfile.organization_id)
        .eq('distributor_org_id', distributorId)
        .in('validation_status', ['pending', 'matched'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (sessionError) {
        console.error('Error checking existing session:', sessionError)
      }

      console.log('📋 Existing session:', existingSession?.id || 'None')

      if (existingSession) {
        console.log('✅ Loading existing session with codes:', {
          master: existingSession.master_codes_scanned?.length || 0,
          unique: existingSession.unique_codes_scanned?.length || 0
        })
        setSessionId(existingSession.id)
        await loadProgressFromSession(existingSession)
        return
      }

      // No pending session found - create a new empty one
      const distributor = distributors.find(d => d.id === distributorId)
      
      console.log('📝 Creating new session for distributor:', distributor?.org_name)
      
      // ============================================================================
      // SCENARIO 1 vs SCENARIO 2: Phone Order vs D2H Order
      // ============================================================================
      // Check if there are any D2H orders (Distributor to HQ) for this distributor
      // that have been approved and have inventory at warehouse ready to ship
      
      let expectedQuantities = {
        total_units: 0,
        total_cases: 0,
        per_variant: {},
        source_order_id: null as string | null,
        scenario: 'phone_order' as 'phone_order' | 'd2h_order'
      }

      console.log('🔍 Checking for D2H orders from distributor:', distributorId)
      
      const { data: d2hOrders, error: orderError } = await supabase
        .from('orders')
        .select(`
          id,
          order_no,
          order_type,
          status,
          order_items (
            id,
            qty,
            variant_id,
            product:products (
              product_name
            ),
            variant:product_variants (
              variant_code,
              variant_name
            )
          )
        `)
        .eq('order_type', 'D2H')
        .eq('buyer_org_id', distributorId)
        .eq('seller_org_id', userProfile.organization_id)
        .in('status', ['approved', 'closed'])
        .order('created_at', { ascending: false })
        .limit(5)

      if (orderError) {
        console.warn('⚠️  Could not check for D2H orders:', orderError)
      }

      console.log(`📊 Found ${d2hOrders?.length || 0} D2H orders`)

      if (d2hOrders && d2hOrders.length > 0) {
        // SCENARIO 2: D2H Order exists - calculate expected quantities from order
        console.log('✅ SCENARIO 2: D2H Order flow - System knows expected quantities')
        
        // Use the most recent approved order
        const sourceOrder = d2hOrders[0]
        const orderItems = sourceOrder.order_items || []
        
        let totalUnits = 0
        const perVariant: any = {}
        
        orderItems.forEach((item: any) => {
          totalUnits += item.qty
          const variantKey = item.variant_id
          
          if (!perVariant[variantKey]) {
            perVariant[variantKey] = {
              variant_id: item.variant_id,
              variant_code: item.variant?.variant_code || 'N/A',
              variant_name: item.variant?.variant_name || item.product?.product_name || 'Unknown',
              expected_qty: 0
            }
          }
          perVariant[variantKey].expected_qty += item.qty
        })
        
        expectedQuantities = {
          total_units: totalUnits,
          total_cases: 0, // Will be calculated as codes are scanned
          per_variant: perVariant,
          source_order_id: sourceOrder.id,
          scenario: 'd2h_order'
        }
        
        console.log('📦 Expected quantities from D2H order:', {
          order_no: sourceOrder.order_no,
          total_units: totalUnits,
          variants: Object.keys(perVariant).length
        })
      } else {
        // SCENARIO 1: Phone Order - no system record
        console.log('📞 SCENARIO 1: Phone order flow - Expected quantities unknown (will scan freely)')
        expectedQuantities = {
          total_units: 0,
          total_cases: 0,
          per_variant: {},
          source_order_id: null,
          scenario: 'phone_order'
        }
      }
      
      // Create session with appropriate expected quantities
      const { data: newSession, error: createError } = await supabase
        .from('qr_validation_reports')
        .insert({
          company_id: userProfile.organizations?.id || userProfile.organization_id,
          warehouse_org_id: userProfile.organization_id,
          distributor_org_id: distributorId,
          source_order_id: expectedQuantities.source_order_id,
          validation_status: 'pending',
          created_by: userProfile.id,
          master_codes_scanned: [],
          unique_codes_scanned: [],
          expected_quantities: {
            total_units: expectedQuantities.total_units,
            total_cases: expectedQuantities.total_cases,
            per_variant: expectedQuantities.per_variant,
            scenario: expectedQuantities.scenario
          },
          scanned_quantities: {
            total_units: 0,
            total_cases: 0,
            per_variant: {}
          }
        })
        .select()
        .single()

      if (createError) {
        console.error('Error creating session:', createError)
        toast({
          title: 'Error',
          description: 'Failed to create shipment session',
          variant: 'destructive'
        })
        return
      }

      console.log('✅ Session created:', newSession.id)
      
      setSessionId(newSession.id)
      setSessionQuantities({ total_units: 0, total_cases: 0, per_variant: {} })
      setShipmentProgress({
        distributor_id: distributorId,
        distributor_name: distributor?.org_name || 'Unknown',
        master_cases_scanned: 0,
        unique_codes_scanned: 0,
        progress_percentage: 0,
        created_at: newSession.created_at || new Date().toISOString()
      })
    } catch (error: any) {
      console.error('Error in createOrLoadSession:', error)
      toast({
        title: 'Error',
        description: 'Failed to initialize shipment session',
        variant: 'destructive'
      })
    }
  }

  const loadProgressFromSession = async (session: any) => {
    const scannedQty = session.scanned_quantities || {}
    const masterCodes = Array.isArray(session.master_codes_scanned) ? session.master_codes_scanned : []
    const uniqueCodes = Array.isArray(session.unique_codes_scanned) ? session.unique_codes_scanned : []
    
    setSessionQuantities({
      total_units: scannedQty.total_units || 0,
      total_cases: scannedQty.total_cases || 0,
      per_variant: scannedQty.per_variant || {}
    })

    const distributor = distributors.find(d => d.id === session.distributor_org_id)
    
    setShipmentProgress({
      distributor_id: session.distributor_org_id,
      distributor_name: distributor?.org_name || 'Unknown',
      master_cases_scanned: masterCodes.length,
      unique_codes_scanned: uniqueCodes.length,
      progress_percentage: 0,
      created_at: session.created_at
    })

    // Load the actual scanned codes with product info to display in Current Ship Progress
    const allCodes = [...masterCodes, ...uniqueCodes]
    if (allCodes.length > 0) {
      await loadExistingScannedCodes(allCodes)
      await calculateDetailedStats(masterCodes, uniqueCodes)
    } else {
      // No codes in session - clear the scanned codes list
      setScannedCodes([])
      setDetailedStats({ masterQrCount: 0, masterTotalUnits: 0, uniqueQrCount: 0, uniqueQrOverlap: 0, uniqueQrValid: 0, finalTotal: 0 })
    }
  }

  const calculateDetailedStats = async (masterCodes: string[], uniqueCodes: string[]) => {
    try {
      console.log('📈 Calculating detailed statistics...')
      
      let masterTotalUnits = 0
      const masterCodeIds = new Set<string>()
      
      // Step 1: Get all master QR codes and their unit counts
      if (masterCodes.length > 0) {
        const { data: masterData, error: masterError } = await supabase
          .from('qr_master_codes')
          .select('id, master_code, actual_unit_count')
          .in('master_code', masterCodes)
        
        if (masterError) {
          console.error('Error loading master codes:', masterError)
        } else if (masterData) {
          masterData.forEach(master => {
            masterCodeIds.add(master.id)
            masterTotalUnits += master.actual_unit_count || 0
          })
        }
      }
      
      // Step 2: Check which unique codes belong to the scanned masters
      let uniqueQrOverlap = 0
      
      if (uniqueCodes.length > 0 && masterCodeIds.size > 0) {
        const { data: uniqueData, error: uniqueError } = await supabase
          .from('qr_codes')
          .select('code, master_code_id')
          .in('code', uniqueCodes)
        
        if (uniqueError) {
          console.error('Error loading unique codes:', uniqueError)
        } else if (uniqueData) {
          uniqueData.forEach(qr => {
            if (qr.master_code_id && masterCodeIds.has(qr.master_code_id)) {
              uniqueQrOverlap++
            }
          })
        }
      }
      
      // Step 3: Calculate final statistics
      const uniqueQrValid = uniqueCodes.length - uniqueQrOverlap
      const finalTotal = masterTotalUnits + uniqueQrValid
      
      setDetailedStats({
        masterQrCount: masterCodes.length,
        masterTotalUnits,
        uniqueQrCount: uniqueCodes.length,
        uniqueQrOverlap,
        uniqueQrValid,
        finalTotal
      })
      
      console.log('✅ Detailed stats:', {
        masterQrCount: masterCodes.length,
        masterTotalUnits,
        uniqueQrCount: uniqueCodes.length,
        uniqueQrOverlap,
        uniqueQrValid,
        finalTotal
      })
    } catch (error) {
      console.error('❌ Error calculating detailed stats:', error)
    }
  }

  const loadExistingScannedCodes = async (codes: string[]) => {
    try {
      console.log('📦 Loading existing scanned codes from session:', codes.length)
      console.log('📝 Sample codes:', codes.slice(0, 3))
      
      // Query QR codes to get product information with images
      const { data: qrCodes, error } = await supabase
        .from('qr_codes')
        .select(`
          code,
          status,
          master_code_id,
          variant_id,
          product_variants (
            variant_name,
            image_url,
            products (
              product_name
            )
          )
        `)
        .in('code', codes)

      console.log('🔍 Query result:', { found: qrCodes?.length || 0, error: error?.message })

      if (error) {
        console.error('❌ Error loading existing codes:', error)
        return
      }

      const qrCodesSafe = qrCodes || []

      if (qrCodesSafe.length === 0) {
        console.warn('⚠️ No QR codes found for the provided codes from session (might be master cases only)')
      }

      // Filter for warehouse_packed status
      const packedCodes = qrCodesSafe.filter(qr => qr.status === 'warehouse_packed')
      console.log('📊 Status breakdown:', {
        total: qrCodes.length,
        warehouse_packed: packedCodes.length,
        other: qrCodes.length - packedCodes.length
      })

      // Transform to ScannedProduct format (only warehouse_packed codes)
      const scannedProducts: ScannedProduct[] = packedCodes.map((qr, index) => {
        const variant = Array.isArray(qr.product_variants) ? qr.product_variants[0] : qr.product_variants
        const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
        
        return {
          code: qr.code,
          product_name: product?.product_name || 'Unknown',
          variant_name: variant?.variant_name || 'Unknown',
          image_url: variant?.image_url || null,
          sequence_number: index + 1,
          status: 'success' as const,
          code_type: 'unique'
        }
      })

      const foundCodes = new Set(packedCodes.map(qr => qr.code))
      const missingCodes = codes.filter(code => !foundCodes.has(code))

      if (missingCodes.length > 0) {
        console.log('📦 Loading master codes missing from qr_codes query:', missingCodes)
        const { data: masterRecords, error: masterError } = await supabase
          .from('qr_master_codes')
          .select(`
            master_code, 
            status,
            qr_batches!inner (
              product_variant_id,
              products!inner (
                product_name
              ),
              product_variants!inner (
                variant_name,
                image_url
              )
            )
          `)
          .in('master_code', missingCodes)

        if (masterError) {
          console.warn('⚠️ Could not load master codes:', masterError)
        } else {
          masterRecords
            ?.filter(master => master.status === 'warehouse_packed')
            .forEach(master => {
              const batch = Array.isArray((master as any).qr_batches) 
                ? (master as any).qr_batches[0] 
                : (master as any).qr_batches
              const product = batch?.products 
                ? (Array.isArray(batch.products) ? batch.products[0] : batch.products)
                : null
              const variant = batch?.product_variants
                ? (Array.isArray(batch.product_variants) ? batch.product_variants[0] : batch.product_variants)
                : null
              
              scannedProducts.push({
                code: master.master_code,
                product_name: product?.product_name || master.master_code,
                variant_name: variant?.variant_name || 'Master Case',
                image_url: variant?.image_url || null,
                sequence_number: scannedProducts.length + 1,
                status: 'success',
                code_type: 'master'
              })
            })
        }
      }

      console.log('✅ Loaded and displaying', scannedProducts.length, 'warehouse_packed codes')
      console.log('📦 Sample product:', scannedProducts[0])
      if (scannedProducts.length === 0) {
        console.warn('⚠️ No warehouse_packed codes found - they may have already been shipped')
        toast({
          title: 'Information',
          description: 'These items may have already been shipped. Check the shipment history.',
          variant: 'default'
        })
        return
      }

      setScannedCodes(scannedProducts)
      
      // After loading scanned codes, also load unique QR codes for master cases to get variant details
      const masterCodes = scannedProducts.filter(p => p.code_type === 'master').map(p => p.code)
      console.log('🎯 Master codes to load variants for:', masterCodes)
      if (masterCodes.length > 0) {
        await loadVariantDetailsFromMasterCodes(masterCodes)
      }
    } catch (error: any) {
      console.error('❌ Error loading existing scanned codes:', error)
    }
  }

  const loadVariantDetailsFromMasterCodes = async (masterCodes: string[]) => {
    try {
      console.log('🔍 Loading variant details from master codes:', masterCodes.length, masterCodes)
      
      // First, get the master_code_ids from master_codes
      const { data: masterRecords, error: masterError } = await supabase
        .from('qr_master_codes')
        .select('id, master_code, actual_unit_count')
        .in('master_code', masterCodes)
      
      if (masterError || !masterRecords || masterRecords.length === 0) {
        console.warn('⚠️ No master code records found:', masterError)
        return
      }
      
      console.log('📦 Found master records:', masterRecords)
      const masterCodeIds = masterRecords.map(m => m.id)
      
      // Now query unique QR codes that belong to these master codes
      const { data: uniqueQrCodes, error: uniqueError } = await supabase
        .from('qr_codes')
        .select(`
          code,
          status,
          variant_id,
          product_variants (
            variant_name,
            image_url,
            products (
              product_name
            )
          )
        `)
        .in('master_code_id', masterCodeIds)
        .eq('status', 'warehouse_packed')
      
      if (uniqueError) {
        console.error('❌ Error loading unique QR codes:', uniqueError)
        return
      }
      
      console.log('✅ Loaded', uniqueQrCodes?.length || 0, 'unique QR codes from master cases')
      if (uniqueQrCodes && uniqueQrCodes.length > 0) {
        console.log('📝 Sample unique QR:', uniqueQrCodes[0])
      }
      
      // Add these unique codes to scannedCodes for proper variant aggregation
      if (uniqueQrCodes && uniqueQrCodes.length > 0) {
        const uniqueProducts: ScannedProduct[] = uniqueQrCodes.map((qr, index) => {
          const variant = Array.isArray(qr.product_variants) ? qr.product_variants[0] : qr.product_variants
          const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
          
          return {
            code: qr.code,
            product_name: product?.product_name || 'Unknown',
            variant_name: variant?.variant_name || 'Unknown',
            image_url: variant?.image_url || null,
            sequence_number: index + 1,
            status: 'success' as const,
            code_type: 'unique'
          }
        })
        
        console.log('🎨 Adding', uniqueProducts.length, 'unique products to scannedCodes')
        console.log('📷 Images available:', uniqueProducts.filter(p => p.image_url).length)
        console.log('📝 Variants:', Array.from(new Set(uniqueProducts.map(p => p.variant_name))))
        
        setScannedCodes(prev => {
          const updated = [...prev, ...uniqueProducts]
          console.log('✅ Updated scannedCodes length:', updated.length)
          return updated
        })
      }
    } catch (error: any) {
      console.error('❌ Error loading variant details:', error)
    }
  }

  const loadScanHistory = async () => {
    try {
      console.log('🔍 Loading warehouse scan history')
      
      const response = await fetch('/api/warehouse/scan-history', {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        cache: 'no-store'
      })
      
      if (!response.ok) {
        if (response.status === 401) {
          console.warn('⚠️ Authentication required for scan history')
          setOverallHistory([])
          setDistributorHistory([])
          return
        }
        throw new Error(`Failed to load scan history: ${response.status}`)
      }

      const result = await response.json()
      
      console.log('📊 Scan history API result:', { 
        success: result.success, 
        count: result.count 
      })

      if (!result.success) {
        throw new Error(result.error || 'Failed to load scan history')
      }

      const history: ScanHistory[] = (result.history || []).map((item: any) => ({
        id: item.id,
        distributor_id: item.distributor_id || '',
        distributor_name: item.distributor_name || 'Unknown',
        master_code: item.master_code,
        product_name: item.product_name,  // NEW: Product name from API
        case_number: item.case_number,
        actual_unit_count: item.actual_unit_count,
        scanned_at: item.scanned_at,
        order_id: item.order_id || null,
        order_no: item.order_no || 'Unknown',
        status: item.status || 'warehouse_packed',
        validation_status: item.validation_status,  // Session validation status
        product_breakdown: item.product_breakdown || {},
        product_images: item.product_images || {},
        pending_master_codes: item.pending_master_codes || [],
        pending_unique_codes: item.pending_unique_codes || []
      }))

      console.log('✅ Scan history loaded:', history.length, 'records')
      setOverallHistory(history)
      setDistributorHistory(selectedDistributor ? history.filter((item) => item.distributor_id === selectedDistributor) : [])
    } catch (error: any) {
      console.error('❌ Error loading scan history:', error)
      setOverallHistory([])
      setDistributorHistory([])
      
      // Only show error toast if it's not an auth issue
      if (!error.message?.includes('401')) {
        toast({
          title: 'Warning',
          description: 'Could not load scan history. Please refresh the page.',
          variant: 'default'
        })
      }
    }
  }

  const handleScanCode = async () => {
    if (!selectedDistributor || !sessionId) {
      toast({
        title: 'Error',
        description: 'Please select a distributor first',
        variant: 'destructive'
      })
      return
    }

    if (!qrInput.trim()) {
      toast({
        title: 'Error',
        description: 'Please scan or enter a QR code',
        variant: 'destructive'
      })
      return
    }

    try {
      setScanning(true)

      const response = await fetch('/api/warehouse/scan-for-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_session_id: sessionId,
          code: qrInput.trim(),
          // code_type removed - let API auto-detect based on QR code pattern
          user_id: userProfile.id
        })
      })

      const result = await response.json()

      if (!response.ok) {
        if (result.outcome === 'duplicate') {
          toast({
            title: 'Warning',
            description: result.message || 'This code has already been scanned',
          })
          setQrInput('')
          return
        }
        throw new Error(result.message || 'Failed to scan QR code')
      }

      if (result.outcome === 'shipped') {
        // Extract product info from result
        const productInfo: ScannedProduct = {
          code: result.normalized_code,
          product_name: result.product_info?.product_name || result.master_case?.master_code || result.normalized_code,
          variant_name: result.product_info?.variant_name || (result.code_type === 'master' ? 'Master Case' : 'Unit'),
          sequence_number: scannedCodes.length + 1,
          status: 'success',
          code_type: result.code_type === 'master' ? 'master' : 'unique'
        }
        
        setScannedCodes(prev => [...prev, productInfo])
        setQrInput('')
        
        toast({
          title: 'Success',
          description: result.message,
        })

        // Update progress
        if (result.session_update) {
          const masterCount = result.session_update.master_codes_scanned?.length || 0
          const uniqueCount = result.session_update.unique_codes_scanned?.length || 0
          const distributor = distributors.find(d => d.id === selectedDistributor)
          
          setShipmentProgress({
            distributor_id: selectedDistributor,
            distributor_name: distributor?.org_name || 'Unknown',
            master_cases_scanned: masterCount,
            unique_codes_scanned: uniqueCount,
            progress_percentage: 0,
            created_at: new Date().toISOString()
          })

          if (result.session_update.scanned_quantities) {
            const quantities = result.session_update.scanned_quantities
            setSessionQuantities({
              total_units: quantities.total_units || 0,
              total_cases: quantities.total_cases || 0,
              per_variant: quantities.per_variant || {}
            })
          }
        }

        loadScanHistory()
      } else {
        toast({
          title: result.outcome === 'already_shipped' ? 'Warning' : 'Error',
          description: result.message,
          variant: result.outcome === 'already_shipped' ? 'default' : 'destructive'
        })
        setQrInput('')
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setScanning(false)
    }
  }

  const handleBatchPaste = async () => {
    if (!batchInput.trim()) {
      toast({
        title: 'Error',
        description: 'Please paste QR codes in the batch input field',
        variant: 'destructive'
      })
      return
    }

    if (!selectedDistributor || !sessionId) {
      toast({
        title: 'Error',
        description: 'Please select a distributor first',
        variant: 'destructive'
      })
      return
    }

    const codes = batchInput
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)

    if (codes.length === 0) {
      toast({
        title: 'Error',
        description: 'No valid QR codes found',
        variant: 'destructive'
      })
      return
    }

    setBatchProcessingActive(true)
    setBatchProcessingProgress(0)
    setBatchProcessingStatus('Preparing batch scan...')
    setBatchProcessingSummary({ total: codes.length, success: 0, duplicates: 0, errors: 0 })

    let successCount = 0
    let duplicateCount = 0
    let errorCount = 0
    let latestTotal = codes.length
    const newScannedCodes: ScannedProduct[] = []

    try {
      const response = await fetch('/api/warehouse/scan-batch-for-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_session_id: sessionId,
          codes,
          user_id: userProfile.id
        })
      })

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null)
        throw new Error(errorPayload?.message || 'Failed to process batch scan')
      }

      if (!response.body) {
        throw new Error('Server returned an empty response stream')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalSummary: { total: number; success: number; duplicates: number; errors: number } | null = null

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          newlineIndex = buffer.indexOf('\n')

          if (!line) continue

          const event = JSON.parse(line)

          if (event.type === 'progress') {
            const { index, total, result } = event
            latestTotal = total || latestTotal

            setBatchProcessingStatus(`Scanning code ${index} of ${total}`)
            setBatchProcessingProgress(Math.round((index / total) * 100))

            const normalizedCode: string = result.normalized_code || codes[index - 1] || ''
            const sequenceNumber = index

            if (result.outcome === 'shipped') {
              successCount++

              newScannedCodes.push({
                code: normalizedCode,
                product_name: result.product_info?.product_name || result.master_case?.master_code || normalizedCode,
                variant_name: result.product_info?.variant_name || (result.code_type === 'master' ? 'Master Case' : 'Unit'),
                sequence_number: sequenceNumber,
                status: 'success',
                code_type: result.code_type === 'master' ? 'master' : 'unique'
              })

              if (result.session_update) {
                const masterCount = result.session_update.master_codes_scanned?.length || 0
                const uniqueCount = result.session_update.unique_codes_scanned?.length || 0
                const distributor = distributors.find(d => d.id === selectedDistributor)

                setShipmentProgress({
                  distributor_id: selectedDistributor,
                  distributor_name: distributor?.org_name || 'Unknown',
                  master_cases_scanned: masterCount,
                  unique_codes_scanned: uniqueCount,
                  progress_percentage: 0,
                  created_at: new Date().toISOString()
                })

                if (result.session_update.scanned_quantities) {
                  const quantities = result.session_update.scanned_quantities
                  console.log('📥 Received scanned_quantities update:', {
                    total_units: quantities.total_units,
                    total_cases: quantities.total_cases,
                    variant_count: Object.keys(quantities.per_variant || {}).length,
                    per_variant: quantities.per_variant
                  })
                  setSessionQuantities({
                    total_units: quantities.total_units || 0,
                    total_cases: quantities.total_cases || 0,
                    per_variant: quantities.per_variant || {}
                  })
                }
              }
            } else if (result.outcome === 'duplicate') {
              duplicateCount++
              newScannedCodes.push({
                code: normalizedCode,
                product_name: normalizedCode,
                variant_name: 'Duplicate',
                sequence_number: sequenceNumber,
                status: 'duplicate',
                error_message: result.message || 'This code has already been scanned in this session',
                code_type: 'unknown'
              })
            } else {
              errorCount++
              newScannedCodes.push({
                code: normalizedCode,
                product_name: normalizedCode,
                variant_name: 'Error',
                sequence_number: sequenceNumber,
                status: 'error',
                error_message: result.message || 'Failed to scan QR code',
                code_type: 'unknown'
              })
            }

            setBatchProcessingSummary({
              total: latestTotal,
              success: successCount,
              duplicates: duplicateCount,
              errors: errorCount
            })
          } else if (event.type === 'complete') {
            finalSummary = event.summary
            if (finalSummary) {
              successCount = finalSummary.success
              duplicateCount = finalSummary.duplicates
              errorCount = finalSummary.errors
              latestTotal = finalSummary.total
              setBatchProcessingSummary(finalSummary)
            }
          } else if (event.type === 'error') {
            throw new Error(event.message || 'Batch processing failed')
          }
        }
      }

      setScannedCodes(prev => [...prev, ...newScannedCodes])

      setBatchProcessingStatus('Batch processing complete!')
      setBatchProcessingProgress(100)

      setTimeout(() => {
        setBatchProcessingActive(false)
        setBatchInput('')
        setShowBatchInput(false)
        loadScanHistory()

        const summary = finalSummary || {
          total: latestTotal,
          success: successCount,
          duplicates: duplicateCount,
          errors: errorCount
        }

        toast({
          title: 'Batch Scan Complete',
          description: `Processed ${summary.total} codes: ${summary.success} success, ${summary.duplicates} duplicates, ${summary.errors} errors`,
        })
      }, 800)
    } catch (error: any) {
      console.error('❌ Batch scan failed:', error)
      setBatchProcessingStatus('Batch processing failed')
      setBatchProcessingProgress(0)
      setBatchProcessingSummary(prev => ({ ...prev, success: successCount, duplicates: duplicateCount, errors: errorCount }))

      toast({
        title: 'Batch Scan Failed',
        description: error.message || 'Unable to complete batch scan',
        variant: 'destructive'
      })

      setTimeout(() => {
        setBatchProcessingActive(false)
      }, 800)
    }
  }

  const handleRemoveCode = (index: number) => {
    setScannedCodes(prev => prev.filter((_, i) => i !== index))
    toast({
      title: 'Removed',
      description: 'QR code removed from session',
    })
  }

  const handleUnlinkCode = async (code: string, codeType: 'master' | 'unique') => {
    if (!sessionId) return

    try {
      setUnlinking(code)

      const response = await fetch('/api/warehouse/unlink-shipment-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          session_id: sessionId,
          code_type: codeType,
          user_id: userProfile.id
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to unlink code')
      }

      toast({
        title: 'Success',
        description: result.message,
      })

      // Remove from scanned codes list immediately for responsive UI
      setScannedCodes(prev => prev.filter(c => c.code !== code))

      // Update session state directly from API response (faster than requery)
      if (result.session_update) {
        const masterCount = result.session_update.master_codes_scanned?.length || 0
        const uniqueCount = result.session_update.unique_codes_scanned?.length || 0
        const distributor = distributors.find(d => d.id === selectedDistributor)
        
        setShipmentProgress({
          distributor_id: selectedDistributor || '',
          distributor_name: distributor?.org_name || 'Unknown',
          master_cases_scanned: masterCount,
          unique_codes_scanned: uniqueCount,
          progress_percentage: 0,
          created_at: new Date().toISOString()
        })

        if (result.session_update.scanned_quantities) {
          const quantities = result.session_update.scanned_quantities
          setSessionQuantities({
            total_units: quantities.total_units || 0,
            total_cases: quantities.total_cases || 0,
            per_variant: quantities.per_variant || {}
          })
        }
      }

      // Reload session to get updated counts and progress (as backup/verification)
      if (selectedDistributor) {
        await createOrLoadSession(selectedDistributor)
      }
      
      // Reload scan history
      await loadScanHistory()

    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setUnlinking(null)
    }
  }

  const handleUnlinkProduct = async (sessionIds: string[], productName: string) => {
    if (!sessionIds || sessionIds.length === 0) return

    if (!confirm(`Unlink all "${productName}" units from these shipments? This will change their status back to received_warehouse.`)) {
      return
    }

    try {
      setUnlinking(productName)

      // Call API to unlink all sessions with this product
      const response = await fetch('/api/warehouse/unlink-product-from-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_ids: sessionIds,
          product_name: productName,
          user_id: userProfile.id
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to unlink product')
      }

      toast({
        title: 'Success',
        description: result.message || `Unlinked ${productName} from shipments`,
      })

      // Reload history
      loadScanHistory()

    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setUnlinking(null)
    }
  }

  const handleCancelShipment = async () => {
    if (!sessionId) {
      toast({
        title: 'Error',
        description: 'No active shipment session to cancel',
        variant: 'destructive'
      })
      return
    }

    const itemCount = masterCasesCount + looseItemsCount + manualQty
    const confirmMsg = `Cancel this shipment and reset ${itemCount} item${itemCount === 1 ? '' : 's'} back to warehouse_packed status?`
    
    if (!confirm(confirmMsg)) {
      return
    }

    try {
      setCanceling(true)

      const response = await fetch('/api/warehouse/cancel-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          user_id: userProfile.id
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to cancel shipment')
      }

      toast({
        title: 'Success',
        description: result.message || 'Shipment cancelled successfully',
      })

      // Clear all state
      setScannedCodes([])
      setManualQty(0)
      setSessionId(null)
      setShipmentProgress(null)
      setSessionQuantities({ total_units: 0, total_cases: 0, per_variant: {} })
      setDetailedStats({ masterQrCount: 0, masterTotalUnits: 0, uniqueQrCount: 0, uniqueQrOverlap: 0, uniqueQrValid: 0, finalTotal: 0 })
      setVariantBreakdown([])

      // Reload manual stock balance if variant selected
      if (selectedVariant) {
        await loadManualStockBalance(selectedVariant)
      }

      // Create fresh session
      if (selectedDistributor) {
        await createOrLoadSession(selectedDistributor)
      }

      await loadScanHistory()

    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to cancel shipment',
        variant: 'destructive'
      })
    } finally {
      setCanceling(false)
    }
  }

  const handleConfirmShipment = async () => {
    if (!selectedDistributor) {
      toast({
        title: 'Error',
        description: 'No distributor selected',
        variant: 'destructive'
      })
      return
    }

    // Check if we have at least one of: QR codes or manual qty
    const hasQrCodes = scannedCodes.filter(c => c.status === 'success').length > 0
    const hasManualQty = manualQty > 0

    if (!hasQrCodes && !hasManualQty) {
      toast({
        title: 'Error',
        description: 'Please scan QR codes or enter manual quantity',
        variant: 'destructive'
      })
      return
    }

    // Ensure we have an active session for QR codes
    if (hasQrCodes && !sessionId) {
      toast({
        title: 'Session Required',
        description: 'No active shipment session. Please reselect the distributor.',
        variant: 'destructive'
      })
      // Try to recreate session
      await createOrLoadSession(selectedDistributor)
      return
    }

    // Validate manual qty doesn't exceed balance
    if (manualQty > manualStockBalance) {
      toast({
        title: 'Error',
        description: `Manual quantity (${manualQty}) exceeds available balance (${manualStockBalance})`,
        variant: 'destructive'
      })
      return
    }

    // Validate variant is selected if manual qty > 0
    if (manualQty > 0 && !selectedVariant) {
      toast({
        title: 'Error',
        description: 'Please select a product variant for manual stock',
        variant: 'destructive'
      })
      return
    }

    const qrUnitsToShip = looseItemsCount
    const totalUnitsToShip = qrUnitsToShip + manualQty
    const confirmBreakdownParts = [
      masterCasesCount > 0 ? `${masterCasesCount} master case${masterCasesCount === 1 ? '' : 's'}` : null,
      qrUnitsToShip > 0 ? `${qrUnitsToShip} QR unit${qrUnitsToShip === 1 ? '' : 's'}` : null,
      manualQty > 0 ? `${manualQty} manual unit${manualQty === 1 ? '' : 's'}` : null
    ].filter(Boolean)
    const confirmMsg = `Confirm shipment of ${totalUnitsToShip} unit${totalUnitsToShip === 1 ? '' : 's'}${confirmBreakdownParts.length ? ` (${confirmBreakdownParts.join(' + ')})` : ''}?`
    
    if (!confirm(confirmMsg)) {
      return
    }

    let manualMovementId: string | null = null

    try {
      setConfirming(true)

      // Prepare QR codes (only successful ones)
      const qrCodes = scannedCodes
        .filter(c => c.status === 'success')
        .map(c => c.code)

      // Generate reference number
      const timestamp = Date.now().toString(36).toUpperCase()
      const referenceNo = `MIX-${timestamp}`

      let qrShippedCount = 0
      let masterCasesShipped = 0
      let manualShippedCount = 0

      // Step 1: Process manual stock first so we can roll back cleanly if later steps fail
      if (manualQty > 0) {
        console.log('📦 Processing manual stock shipment...', manualQty)

        const { data: manualResult, error: manualError } = await supabase.rpc('wms_ship_mixed', {
          p_company_id: userProfile.organizations?.id || userProfile.organization_id,
          p_warehouse_id: userProfile.organization_id,
          p_distributor_id: selectedDistributor,
          p_variant_id: selectedVariant || '',
          p_manual_qty: manualQty || 0,
          p_qr_codes: null,
          p_user_id: userProfile.id,
          p_reference_no: referenceNo,
          p_notes: `Mixed shipment: ${qrCodes.length} QR codes + ${manualQty} manual units`
        })

        if (manualError) {
          throw new Error(manualError.message || 'Failed to process manual shipment')
        }

        const manualResultData = manualResult as { manual_movement_id?: string; manual_quantity?: number } | null
        manualMovementId = manualResultData?.manual_movement_id ?? null
        manualShippedCount = manualResultData?.manual_quantity ?? manualQty

        console.log('✅ Manual stock shipment processed', manualResult)
      }

      // Step 2: Confirm QR shipment via dedicated API (handles movement + inventory)
      if (qrCodes.length > 0) {
        if (!sessionId) {
          throw new Error('Active shipment session not found. Please reselect the distributor and try again.')
        }

        console.log('📦 Confirming QR shipment via API…', { sessionId, qrCount: qrCodes.length })

        const response = await fetch('/api/warehouse/confirm-shipment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            user_id: userProfile.id
          })
        })

        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || 'Failed to confirm QR shipment')
        }

        qrShippedCount = result.details?.unique_codes_shipped ?? qrCodes.length
        masterCasesShipped = result.details?.master_cases_shipped ?? 0

        console.log('✅ QR shipment confirmed via API', result.details)
        // Manual succeeded and QR succeeded, no rollback needed
        manualMovementId = null
      }

      manualMovementId = null

      const breakdownParts = [
        masterCasesShipped > 0 ? `${masterCasesShipped} master case${masterCasesShipped === 1 ? '' : 's'}` : null,
        qrShippedCount > 0 ? `${qrShippedCount} QR unit${qrShippedCount === 1 ? '' : 's'}` : null,
        manualShippedCount > 0 ? `${manualShippedCount} manual unit${manualShippedCount === 1 ? '' : 's'}` : null
      ].filter(Boolean)

      const totalUnitsShipped = qrShippedCount + manualShippedCount

      toast({
        title: 'Success',
        description: `Shipment confirmed! ${totalUnitsShipped} unit${totalUnitsShipped === 1 ? '' : 's'} shipped${breakdownParts.length ? ` (${breakdownParts.join(' + ')})` : ''}.`,
      })

      // Clear current session completely - force new session creation
      setSessionId(null)
      setScannedCodes([])
      setManualQty(0)
      setShipmentProgress(null)
  setSessionQuantities({ total_units: 0, total_cases: 0, per_variant: {} })

      if (selectedVariant) {
        await loadManualStockBalance(selectedVariant)
      } else {
        setManualStockBalance(0)
      }

      // Create a fresh session for the next shipment
      if (selectedDistributor) {
        await createOrLoadSession(selectedDistributor)
      }

      await loadScanHistory()
      await loadIntakeHistory(undefined, { silent: true })

    } catch (error: any) {
      console.error('Shipment error:', error)

      if (manualMovementId) {
        console.warn('♻️ Attempting to roll back manual shipment', manualMovementId)
        try {
          await supabase.rpc('wms_reverse_manual_movement', {
            p_movement_id: manualMovementId,
            p_reversal_reason: `Mixed shipment rollback: ${error.message ?? 'unknown error'}`,
            p_override_user: userProfile.id
          })
          console.log('♻️ Manual shipment rollback succeeded')
        } catch (rollbackError) {
          console.error('⚠️ Failed to roll back manual shipment', rollbackError)
        }
      }

      toast({
        title: 'Error',
        description: error.message || 'Failed to confirm shipment',
        variant: 'destructive'
      })
    } finally {
      setConfirming(false)
    }
  }

  const renderStatusBadge = (status?: string) => {
    switch (status) {
      case 'warehouse_packed':
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-900 border-blue-200 text-[10px] px-2 py-0.5">
            Warehouse Packed
          </Badge>
        )
      case 'shipped_distributor':
      case 'shipped':
        return (
          <Badge variant="default" className="bg-green-600 text-[10px] px-2 py-0.5">
            <CheckCircle className="h-3 w-3 mr-1" />
            Shipped
          </Badge>
        )
      case 'received_distributor':
      case 'received':
        return (
          <Badge variant="default" className="bg-purple-600 text-[10px] px-2 py-0.5">
            Received by Distributor
          </Badge>
        )
      default:
        return (
          <Badge variant="secondary" className="uppercase text-[10px] px-2 py-0.5">
            {status?.replace(/_/g, ' ') || 'Unknown'}
          </Badge>
        )
    }
  }

  const progressPercent = shipmentProgress ? Math.min(100, Math.max(0, shipmentProgress.progress_percentage || 0)) : 0

  // Calculate enhanced summary from scanned codes
  const scanSummary = scannedCodes.reduce((acc, code) => {
    if (code.status === 'success') {
      acc.successCount++
      if (code.code_type === 'master') {
        acc.masterCases++
        // For master cases, also track variant if we have product info
        if (code.product_name && code.variant_name && code.variant_name !== 'Master Case') {
          const variantKey = `${code.product_name} - ${code.variant_name}`
          acc.variants[variantKey] = (acc.variants[variantKey] || 0) + 1
        }
      } else if (code.code_type === 'unique') {
        acc.uniqueCodes++
        // Track variants by full product name
        const variantKey = `${code.product_name} - ${code.variant_name}`
        acc.variants[variantKey] = (acc.variants[variantKey] || 0) + 1
      }
    } else if (code.status === 'duplicate') {
      acc.duplicateCount++
    } else if (code.status === 'error') {
      acc.errorCount++
    }
    return acc
  }, {
    successCount: 0,
    masterCases: 0,
    uniqueCodes: 0,
    duplicateCount: 0,
    errorCount: 0,
    variants: {} as Record<string, number>
  })
  
  // Use sessionQuantities as single source of truth for all counts
  const masterCasesCount = shipmentProgress?.master_cases_scanned || 0
  const looseItemsCount = sessionQuantities.total_units || 0
  const variantCount = Object.keys(sessionQuantities.per_variant || {}).length
  const totalScanned = looseItemsCount + manualQty
  
  // Debug: Log sessionQuantities whenever it changes
  console.log('📊 Current Ship Progress (sessionQuantities):', {
    total_units: sessionQuantities.total_units,
    total_cases: sessionQuantities.total_cases,
    variant_count: variantCount,
    per_variant: sessionQuantities.per_variant
  })
  
  // Build variant breakdown from sessionQuantities.per_variant with enriched data
  const [variantBreakdown, setVariantBreakdown] = useState<Array<{
    variantId: string
    variantName: string
    productName: string
    imageUrl: string | null
    units: number
    cases: number
  }>>([])

  // Aggregated Distributor History
  const aggregatedDistributorHistory = useMemo(() => {
    const productAggregation: Record<string, { units: number, lastScanned: string, status: string, distributorName: string, sessionIds: string[], validation_status?: string, variantName: string, imageUrl: string | null }> = {}
    
    distributorHistory.forEach(item => {
      Object.entries(item.product_breakdown).forEach(([product, qty]) => {
        if (!productAggregation[product]) {
          // Try to extract variant name if product string is "Product - Variant"
          let variantName = product
          if (product.includes(' - ')) {
            const parts = product.split(' - ')
            if (parts.length > 1) variantName = parts[parts.length - 1]
          } else if (product.includes('[')) {
             // Handle "Product Name [ Variant Name ]" format if exists
             const match = product.match(/\[(.*?)\]/)
             if (match && match[1]) variantName = match[1].trim()
          }

          productAggregation[product] = {
            units: 0,
            lastScanned: item.scanned_at,
            status: item.status,
            distributorName: item.distributor_name,
            sessionIds: [],
            validation_status: item.validation_status,
            variantName: variantName,
            imageUrl: item.product_images?.[product] || null
          }
        }
        productAggregation[product].units += Number(qty)
        productAggregation[product].sessionIds.push(item.id)
        // Keep the most recent scan time
        if (new Date(item.scanned_at) > new Date(productAggregation[product].lastScanned)) {
          productAggregation[product].lastScanned = item.scanned_at
          productAggregation[product].status = item.status
          productAggregation[product].validation_status = item.validation_status
        }
      })
    })
    return Object.entries(productAggregation).map(([product, data]) => ({ product, ...data }))
  }, [distributorHistory])

  // Aggregated Overall History
  const aggregatedOverallHistory = useMemo(() => {
    const aggregation: Record<string, { distributor: string, product: string, units: number, lastScanned: string, status: string, sessionIds: string[], variantName: string, imageUrl: string | null, orderNos: Set<string> }> = {}
    
    overallHistory.forEach(item => {
      // Apply filters
      if (overallFilterOrderNo && !item.order_no?.toLowerCase().includes(overallFilterOrderNo.trim().toLowerCase())) {
        return
      }
      if (overallFilterDistributor && !item.distributor_name?.toLowerCase().includes(overallFilterDistributor.trim().toLowerCase())) {
        return
      }
      if (overallFilterDate) {
        const date = new Date(item.scanned_at)
        const month = (date.getMonth() + 1).toString().padStart(2, '0')
        const year = date.getFullYear().toString().slice(-2)
        const mmyy = `${month}${year}`
        if (!mmyy.includes(overallFilterDate)) {
          return
        }
      }

      Object.entries(item.product_breakdown).forEach(([product, qty]) => {
        // Apply Product Filter
        if (overallFilterProduct && !product.toLowerCase().includes(overallFilterProduct.trim().toLowerCase())) {
          return
        }

        const key = `${item.distributor_id}|||${product}`
        if (!aggregation[key]) {
          // Try to extract variant name
          let variantName = product
          if (product.includes(' - ')) {
            const parts = product.split(' - ')
            if (parts.length > 1) variantName = parts[parts.length - 1]
          } else if (product.includes('[')) {
             const match = product.match(/\[(.*?)\]/)
             if (match && match[1]) variantName = match[1].trim()
          }

          aggregation[key] = {
            distributor: item.distributor_name,
            product: product,
            units: 0,
            lastScanned: item.scanned_at,
            status: item.status,
            sessionIds: [],
            variantName: variantName,
            imageUrl: item.product_images?.[product] || null,
            orderNos: new Set()
          }
        }
        aggregation[key].units += Number(qty)
        aggregation[key].sessionIds.push(item.id)
        aggregation[key].orderNos.add(item.order_no || 'Unknown')
        if (new Date(item.scanned_at) > new Date(aggregation[key].lastScanned)) {
          aggregation[key].lastScanned = item.scanned_at
          aggregation[key].status = item.status
        }
      })
    })
    return Object.values(aggregation).map(item => ({
      ...item,
      orderNos: Array.from(item.orderNos)
    }))
  }, [overallHistory, overallFilterOrderNo, overallFilterDistributor, overallFilterDate, overallFilterProduct])

  const sortedDistributorHistory = useMemo(() => {
    return [...aggregatedDistributorHistory].sort((a, b) => {
      const aValue = a[distributorSortColumn as keyof typeof a]
      const bValue = b[distributorSortColumn as keyof typeof b]
      
      if (aValue === bValue) return 0
      
      const direction = distributorSortDirection === 'asc' ? 1 : -1
      
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return aValue.localeCompare(bValue) * direction
      }
      
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return (aValue - bValue) * direction
      }
      
      return 0
    })
  }, [aggregatedDistributorHistory, distributorSortColumn, distributorSortDirection])

  const sortedOverallHistory = useMemo(() => {
    return [...aggregatedOverallHistory].sort((a, b) => {
      const aValue = a[overallSortColumn as keyof typeof a]
      const bValue = b[overallSortColumn as keyof typeof b]
      
      if (aValue === bValue) return 0
      
      const direction = overallSortDirection === 'asc' ? 1 : -1
      
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return aValue.localeCompare(bValue) * direction
      }
      
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return (aValue - bValue) * direction
      }
      
      return 0
    })
  }, [aggregatedOverallHistory, overallSortColumn, overallSortDirection])

  const paginatedDistributorHistory = sortedDistributorHistory.slice((distributorHistoryPage - 1) * ITEMS_PER_PAGE, distributorHistoryPage * ITEMS_PER_PAGE)
  const paginatedOverallHistory = sortedOverallHistory.slice((overallHistoryPage - 1) * ITEMS_PER_PAGE, overallHistoryPage * ITEMS_PER_PAGE)

  const handleDistributorSort = (column: string) => {
    if (distributorSortColumn === column) {
      setDistributorSortDirection(distributorSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setDistributorSortColumn(column)
      setDistributorSortDirection('desc')
    }
  }

  const getDistributorSortIcon = (column: string) => {
    if (distributorSortColumn !== column) return <ArrowUpDown className="ml-2 h-3 w-3" />
    return distributorSortDirection === 'asc' ? <ArrowUp className="ml-2 h-3 w-3" /> : <ArrowDown className="ml-2 h-3 w-3" />
  }

  const handleOverallSort = (column: string) => {
    if (overallSortColumn === column) {
      setOverallSortDirection(overallSortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setOverallSortColumn(column)
      setOverallSortDirection('desc')
    }
  }

  const getOverallSortIcon = (column: string) => {
    if (overallSortColumn !== column) return <ArrowUpDown className="ml-2 h-3 w-3" />
    return overallSortDirection === 'asc' ? <ArrowUp className="ml-2 h-3 w-3" /> : <ArrowDown className="ml-2 h-3 w-3" />
  }

  // Fetch variant details when sessionQuantities.per_variant changes
  useEffect(() => {
    const fetchVariantDetails = async () => {
      const variantIds = Object.keys(sessionQuantities.per_variant || {})
      if (variantIds.length === 0) {
        setVariantBreakdown([])
        return
      }
      
      try {
        const { data, error } = await supabase
          .from('product_variants')
          .select(`
            id,
            variant_name,
            image_url,
            products (
              product_name
            )
          `)
          .in('id', variantIds)
        
        if (error) {
          console.error('Error fetching variant details:', error)
          return
        }
        
        const enrichedVariants = (data || []).map(variant => {
          const product = Array.isArray(variant.products) ? variant.products[0] : variant.products
          const variantData = sessionQuantities.per_variant[variant.id] || { units: 0, cases: 0 }
          
          return {
            variantId: variant.id,
            variantName: variant.variant_name || 'Unknown',
            productName: product?.product_name || 'Unknown',
            imageUrl: variant.image_url || null,
            units: variantData.units || 0,
            cases: variantData.cases || 0
          }
        })
        
        setVariantBreakdown(enrichedVariants)
      } catch (error) {
        console.error('Error in fetchVariantDetails:', error)
      }
    }
    
    fetchVariantDetails()
  // Use JSON.stringify to properly detect object content changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(sessionQuantities.per_variant), supabase])

  return (
    <>
      {/* Batch Processing Modal */}
      <Dialog open={batchProcessingActive} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-center">Processing Batch</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="text-center">
              <p className="text-lg text-gray-700 mb-2">{batchProcessingStatus}</p>
              <p className="text-sm text-gray-500 uppercase tracking-wide font-semibold">
                {batchProcessingSummary.success + batchProcessingSummary.duplicates + batchProcessingSummary.errors} OF {batchProcessingSummary.total} CODES SCANNED
              </p>
            </div>

            <Progress value={batchProcessingProgress} className="h-3" />

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <p className="text-sm font-medium text-blue-600 mb-1">SUCCESS</p>
                <p className="text-3xl font-bold text-blue-700">{batchProcessingSummary.success}</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-4 text-center">
                <p className="text-sm font-medium text-orange-600 mb-1">DUPLICATES</p>
                <p className="text-3xl font-bold text-orange-700">{batchProcessingSummary.duplicates}</p>
              </div>
              <div className="bg-red-50 rounded-lg p-4 text-center">
                <p className="text-sm font-medium text-red-600 mb-1">ERRORS</p>
                <p className="text-3xl font-bold text-red-700">{batchProcessingSummary.errors}</p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Warehouse Ship</h1>
          <p className="text-gray-600 mt-1">
            Scan master cases and unique QR codes for distributor shipments
          </p>
        </div>

      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <Target className="h-5 w-5 text-blue-600" />
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Distributor
              </label>
              <select
                value={selectedDistributor}
                onChange={(e) => setSelectedDistributor(e.target.value)}
                className="w-full px-4 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Choose distributor...</option>
                {distributors.map(distributor => (
                  <option key={distributor.id} value={distributor.id}>
                    {distributor.org_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Manual Stock Section */}
      {selectedDistributor && (
        <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-purple-900">
              <Box className="h-5 w-5" />
              Manual Stock Addition
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Variant Selection with Search */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Product Variant {variantsWithStock.length > 0 && `(${variantsWithStock.length} available)`}
                </label>
                {selectedVariant && (
                  <div className="mb-2 p-2 bg-purple-100 border border-purple-300 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-xs text-purple-600 font-medium">Selected:</p>
                        <p className="text-sm font-semibold text-purple-900">
                          {(() => {
                            const variant = variantsWithStock.find(v => v.id === selectedVariant)
                            const product = variant ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
                            return variant ? `${product?.product_name} - ${variant.variant_name}` : 'Unknown'
                          })()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedVariant('')}
                        className="h-8 w-8 p-0 hover:bg-purple-200"
                      >
                        <XCircle className="h-4 w-4 text-purple-600" />
                      </Button>
                    </div>
                  </div>
                )}
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search product variant..."
                    value={variantSearchTerm}
                    onChange={(e) => setVariantSearchTerm(e.target.value)}
                    onFocus={() => setVariantSearchTerm('')}
                    className="w-full pl-10 pr-4 py-2 border border-purple-300 rounded-t-lg focus:ring-2 focus:ring-purple-500 bg-white text-sm"
                  />
                </div>
                <div className="border border-t-0 border-purple-300 rounded-b-lg bg-white max-h-64 overflow-y-auto">
                  {loadingVariants ? (
                    <div className="p-4 text-center text-gray-500">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Loading variants...
                    </div>
                  ) : variantsWithStock.length === 0 ? (
                    <div className="p-4 text-center text-gray-500">
                      <Box className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                      <p className="text-sm">No variants with manual stock available</p>
                    </div>
                  ) : (
                    variantsWithStock
                      .filter(variant => {
                        if (!variantSearchTerm) return true
                        const product = Array.isArray(variant.products) ? variant.products[0] : variant.products
                        const searchLower = variantSearchTerm.toLowerCase()
                        const productName = product?.product_name?.toLowerCase() || ''
                        const variantName = variant.variant_name?.toLowerCase() || ''
                        return productName.includes(searchLower) || variantName.includes(searchLower)
                      })
                      .map(variant => {
                        const product = Array.isArray(variant.products) ? variant.products[0] : variant.products
                        const isSelected = selectedVariant === variant.id
                        return (
                          <div
                            key={variant.id}
                            onClick={() => {
                              setSelectedVariant(variant.id)
                              setVariantSearchTerm('')
                            }}
                            className={`px-4 py-3 cursor-pointer hover:bg-purple-50 border-b border-gray-100 last:border-b-0 ${
                              isSelected ? 'bg-purple-100' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <p className="text-sm font-medium text-gray-900">
                                  {product?.product_name}
                                </p>
                                <p className="text-xs text-gray-600">
                                  {variant.variant_name}
                                </p>
                              </div>
                              <Badge variant="secondary" className="ml-2">
                                {variant.manual_balance_qty} units
                              </Badge>
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>
              </div>

              {/* Manual Quantity Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Manual Quantity to Ship
                </label>
                <input
                  type="number"
                  min="0"
                  max={manualStockBalance}
                  value={manualQty}
                  onChange={(e) => setManualQty(Math.max(0, Math.min(manualStockBalance, parseInt(e.target.value) || 0)))}
                  disabled={!selectedVariant || loadingManualStock}
                  placeholder="Enter quantity..."
                  className="w-full px-4 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white disabled:bg-gray-100"
                />
              </div>
            </div>

            {/* Stock Balance Display */}
            {selectedVariant && (
              <div className="bg-white border border-purple-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">
                    Available Manual Stock Balance:
                  </span>
                  <Badge variant={manualStockBalance > 0 ? "default" : "secondary"} className="text-lg">
                    {loadingManualStock ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      `${manualStockBalance} units`
                    )}
                  </Badge>
                </div>
                {manualQty > 0 && (
                  <div className="mt-2 pt-2 border-t border-purple-100">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600">After shipment:</span>
                      <span className="font-semibold text-purple-700">
                        {manualStockBalance - manualQty} units remaining
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Alert className="border-purple-200 bg-purple-50">
              <AlertDescription className="text-purple-800 text-sm">
                <strong>Note:</strong> Manual stock is for items added without QR codes. 
                You can ship a mix of QR-coded items (scanned below) and manual stock items together.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      {shipmentProgress && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-green-900">
                <Truck className="h-5 w-5" />
                Current Ship Progress: Distributor: {shipmentProgress.distributor_name}
              </CardTitle>
              {(masterCasesCount > 0 || looseItemsCount > 0 || manualQty > 0) && (
                <div className="flex gap-2">
                  <Button
                    onClick={handleCancelShipment}
                    disabled={canceling || confirming || (masterCasesCount === 0 && looseItemsCount === 0 && manualQty === 0)}
                    variant="outline"
                    className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    {canceling ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4 mr-2" />
                    )}
                    Cancel Shipment
                  </Button>
                  <Button
                    onClick={handleConfirmShipment}
                    disabled={confirming || canceling || (masterCasesCount === 0 && looseItemsCount === 0 && manualQty === 0)}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {confirming ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-2" />
                    )}
                    Confirm Shipment
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Detailed Statistics */}
            {(detailedStats.masterQrCount > 0 || detailedStats.uniqueQrCount > 0) && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 space-y-3">
                <h4 className="text-sm font-bold text-gray-800">Intelligent Scan Summary (No Double Counting)</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-600">Master QR Codes</div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-green-700">{detailedStats.masterQrCount}</span>
                      <span className="text-sm text-gray-600">cases</span>
                    </div>
                    <div className="text-xs text-green-700 font-medium">
                      = {detailedStats.masterTotalUnits} units total
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-600">Unique QR Codes</div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-blue-700">{detailedStats.uniqueQrCount}</span>
                      <span className="text-sm text-gray-600">scanned</span>
                    </div>
                    {detailedStats.uniqueQrOverlap > 0 && (
                      <div className="text-xs text-amber-600 font-medium">
                        ⚠ {detailedStats.uniqueQrOverlap} overlap with master (excluded)
                      </div>
                    )}
                    <div className="text-xs text-blue-700 font-medium">
                      ✓ {detailedStats.uniqueQrValid} valid unique codes
                    </div>
                  </div>
                  
                  <div className="space-y-2 bg-white rounded-lg p-3 border-2 border-indigo-300">
                    <div className="text-xs font-medium text-gray-600">FINAL TOTAL TO DELIVER</div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold text-indigo-700">{totalScanned}</span>
                      <span className="text-sm text-gray-600">units</span>
                    </div>
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <div>{sessionQuantities.total_units} scanned units</div>
                      {manualQty > 0 && <div>{manualQty} manual stock</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Main counts */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="bg-white border border-green-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Master Cases</span>
                  <span className="text-2xl font-bold text-green-700">
                    {masterCasesCount}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  Full cases scanned
                </p>
              </div>

              <div className="bg-white border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Loose Items</span>
                  <span className="text-2xl font-bold text-blue-700">
                    {looseItemsCount}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  Individual units
                </p>
              </div>

              <div className="bg-white border border-purple-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Manual Stock</span>
                  <span className="text-2xl font-bold text-purple-700">
                    {manualQty}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  Non-QR units
                </p>
              </div>

              <div className="bg-white border border-orange-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Variants</span>
                  <span className="text-2xl font-bold text-orange-700">
                    {variantCount + (manualQty > 0 ? 1 : 0)}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  Product types
                </p>
              </div>

              <div className="bg-white border border-indigo-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Total Items</span>
                  <span className="text-2xl font-bold text-indigo-700">
                    {looseItemsCount + manualQty}
                  </span>
                </div>
                <p className="text-xs text-gray-600">
                  Ready to ship
                </p>
              </div>
            </div>

            {/* Variant breakdown with images */}
            {variantCount > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Product Variant Breakdown</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {variantBreakdown.map((variant) => (
                    <div key={variant.variantId} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
                      <div className="flex-shrink-0 w-12 h-12 bg-white rounded-md overflow-hidden border border-gray-200 flex items-center justify-center">
                        {variant.imageUrl ? (
                          <img 
                            src={variant.imageUrl} 
                            alt={variant.variantName}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <Box className="h-6 w-6 text-gray-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-700 font-medium truncate">{variant.variantName}</div>
                        <div className="text-xs text-gray-500">{variant.productName}</div>
                      </div>
                      <div className="flex flex-col items-end">
                        <Badge variant="secondary" className="flex-shrink-0">{variant.units}</Badge>
                        {variant.cases > 0 && (
                          <span className="text-xs text-gray-500 mt-1">{variant.cases} cases</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status summary */}
            {(scanSummary.duplicateCount > 0 || scanSummary.errorCount > 0) && (
              <div className="flex gap-4 text-sm">
                {scanSummary.duplicateCount > 0 && (
                  <div className="flex items-center gap-2 text-orange-700">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{scanSummary.duplicateCount} duplicate{scanSummary.duplicateCount > 1 ? 's' : ''}</span>
                  </div>
                )}
                {scanSummary.errorCount > 0 && (
                  <div className="flex items-center gap-2 text-red-700">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{scanSummary.errorCount} error{scanSummary.errorCount > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>
            )}

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">Scanning Progress</span>
                <span className="text-gray-900 font-bold">{totalScanned} units ready</span>
              </div>
              <p className="text-xs text-gray-600">
                Status: <strong>warehouse_packed</strong> - Ready to confirm shipment
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scan className="h-5 w-5" />
            Scan for Distributor Shipment
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!selectedDistributor && (
            <Alert className="border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Please select a distributor above to begin batch scanning for shipment.
              </AlertDescription>
            </Alert>
          )}

          <div className="border border-blue-200 rounded-lg p-4 bg-blue-50 space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                Paste Multiple QR Codes (one per line)
              </label>
              <textarea
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                placeholder="Paste QR codes here... (one per line)&#10;MASTER-ORD-XX-XXXX-XX-CASE-XXX&#10;MASTER-ORD-XX-XXXX-XX-CASE-XXX&#10;..."
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                disabled={!selectedDistributor}
              />
              <div className="flex gap-2">
                <Button
                  onClick={handleBatchPaste}
                  disabled={!batchInput.trim() || !selectedDistributor || scanning}
                  className="flex-1"
                >
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  {scanning ? 'Processing...' : 'Process Batch'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setBatchInput('')}
                  disabled={!selectedDistributor}
                >
                  Clear
                </Button>
              </div>
              <div className="text-xs text-gray-600">
                {batchInput.trim().length > 0 ? (() => {
                  const allCodes = batchInput.split('\n').filter(line => line.trim().length > 0)
                  
                  // Categorize codes
                  const uniqueCodesSet = new Set<string>()
                  let masterCount = 0
                  let uniqueProductCount = 0
                  const duplicates: string[] = []
                  
                  allCodes.forEach(line => {
                    const code = line.trim()
                    
                    // Extract clean code from URL if present
                    let cleanCode = code
                    if (code.includes('/track/master/')) {
                      cleanCode = code.split('/track/master/')[1] || code
                    } else if (code.includes('/track/product/')) {
                      cleanCode = code.split('/track/product/')[1] || code
                    }
                    
                    // Check if already seen (duplicate)
                    if (uniqueCodesSet.has(cleanCode)) {
                      duplicates.push(code)
                      return
                    }
                    
                    uniqueCodesSet.add(cleanCode)
                    
                    // Categorize by type
                    if (cleanCode.startsWith('MASTER-')) {
                      masterCount++
                    } else if (cleanCode.startsWith('PROD-')) {
                      uniqueProductCount++
                    } else {
                      // Unknown format, count as unique product
                      uniqueProductCount++
                    }
                  })
                  
                  const totalUnique = uniqueCodesSet.size
                  
                  return (
                    <div className="space-y-2">
                      <div>
                        Detected <strong>{allCodes.length}</strong> QR code{allCodes.length !== 1 ? 's' : ''} total
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex gap-4">
                          <span className="text-green-600">
                            ✓ <strong>{totalUnique}</strong> unique code{totalUnique !== 1 ? 's' : ''} (will be scanned)
                          </span>
                          {duplicates.length > 0 && (
                            <span className="text-amber-600">
                              ⚠ <strong>{duplicates.length}</strong> duplicate{duplicates.length !== 1 ? 's' : ''} (will be skipped)
                            </span>
                          )}
                        </div>
                        {totalUnique > 0 && (
                          <div className="flex gap-4 pl-4 text-xs text-gray-500">
                            {masterCount > 0 && (
                              <span>
                                📦 <strong>{masterCount}</strong> master case{masterCount !== 1 ? 's' : ''}
                              </span>
                            )}
                            {uniqueProductCount > 0 && (
                              <span>
                                🏷️ <strong>{uniqueProductCount}</strong> unique product{uniqueProductCount !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })() : (
                  <span>Paste QR codes above to preview how many will be processed.</span>
                )}
              </div>
            </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                Scanned Codes ({scannedCodes.length})
              </label>
              {scannedCodes.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setScannedCodes([])}
                >
                  Clear All
                </Button>
              )}
            </div>

            <div className="border border-gray-200 rounded-lg max-h-96 overflow-y-auto">
              {scannedCodes.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <QrCode className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                  <p>No codes scanned yet</p>
                  <p className="text-sm">Scan QR codes to begin shipment preparation</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {scannedCodes.map((code, index) => (
                    <div key={index} className={`p-3 flex items-center justify-between hover:bg-gray-50 ${
                      code.status === 'error' ? 'bg-red-50' : 
                      code.status === 'duplicate' ? 'bg-orange-50' : 
                      'bg-green-50'
                    }`}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="text-xs">
                            #{code.sequence_number}
                          </Badge>
                          {code.status === 'success' && (
                            <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Success
                            </Badge>
                          )}
                          {code.status === 'duplicate' && (
                            <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-xs">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Duplicate
                            </Badge>
                          )}
                          {code.status === 'error' && (
                            <Badge className="bg-red-100 text-red-800 border-red-200 text-xs">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Error
                            </Badge>
                          )}
                          <p className="text-sm font-medium text-gray-900">
                            {code.product_name}
                          </p>
                        </div>
                        <p className="text-xs text-gray-500">
                          {code.variant_name}
                        </p>
                        <p className="text-xs text-gray-400 font-mono mt-1">
                          {code.code}
                        </p>
                        {code.error_message && (
                          <div className="mt-2 p-2 bg-white border border-red-200 rounded text-xs text-red-700">
                            <strong>Reason:</strong> {code.error_message}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {code.status === 'success' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleUnlinkCode(code.code, code.code_type === 'master' ? 'master' : 'unique')}
                            disabled={unlinking === code.code || confirming}
                            className="hover:bg-orange-50 text-orange-600 border-orange-300"
                          >
                            {unlinking === code.code ? (
                              <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                              'Unlink'
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveCode(index)}
                          className="hover:bg-red-50"
                          disabled={unlinking === code.code}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-indigo-100 mb-6">
        <CardHeader className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 justify-between">
              <CardTitle className="flex items-center gap-2 text-indigo-900">
                <History className="h-5 w-5" />
                Warehouse Scan History
              </CardTitle>
            </div>
            <p className="text-sm text-gray-500">
              Showing orders received between {formatDateOnly(historyRange.start)} and {formatDateOnly(historyRange.end)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
              {formatNumber(historySummary.cases)} case{historySummary.cases === 1 ? '' : 's'}
            </Badge>
            <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">
              {formatNumber(historySummary.units)} units
            </Badge>
            <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
              {historyTotal} record{historyTotal === 1 ? '' : 's'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {historyError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {historyError}
            </div>
          )}

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={historyPreset}
                onValueChange={(value) => {
                  setHistoryPreset(value as HistoryPreset)
                  setHistoryPage(1)
                }}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Date range" />
                </SelectTrigger>
                <SelectContent>
                  {HISTORY_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                <CalendarRange className="h-4 w-4" />
                <span>
                  {formatDateOnly(historyRange.start)}
                  <span className="mx-1 text-gray-400">→</span>
                  {formatDateOnly(historyRange.end)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3 w-full lg:w-auto lg:flex-row lg:items-center">
              <div className="relative w-full lg:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={historySearchInput}
                  onChange={(event) => setHistorySearchInput(event.target.value)}
                  placeholder="Search order or buyer"
                  className="pl-9"
                />
              </div>

              <Select
                value={String(historyPageSize)}
                onValueChange={(value) => {
                  setHistoryPageSize(Number(value))
                  setHistoryPage(1)
                }}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Page size" />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 30, 40, 50].map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead 
                    className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleHistorySort('orderNo')}
                  >
                    <div className="flex items-center">
                      Order
                      {getSortIcon('orderNo')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleHistorySort('sellerOrgName')}
                  >
                    <div className="flex items-center">
                      Seller
                      {getSortIcon('sellerOrgName')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleHistorySort('casesScanned')}
                  >
                    <div className="flex items-center">
                      Cases Scanned
                      {getSortIcon('casesScanned')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleHistorySort('unitsScanned')}
                  >
                    <div className="flex items-center">
                      Units Scanned
                      {getSortIcon('unitsScanned')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleHistorySort('casesReceived')}
                  >
                    <div className="flex items-center">
                      Cases Received
                      {getSortIcon('casesReceived')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleHistorySort('unitsReceived')}
                  >
                    <div className="flex items-center">
                      Units Received
                      {getSortIcon('unitsReceived')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleHistorySort('casesShipped')}
                  >
                    <div className="flex items-center">
                      Cases Shipped
                      {getSortIcon('casesShipped')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleHistorySort('unitsShipped')}
                  >
                    <div className="flex items-center">
                      Units Shipped
                      {getSortIcon('unitsShipped')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleHistorySort('firstReceivedAt')}
                  >
                    <div className="flex items-center">
                      First Received
                      {getSortIcon('firstReceivedAt')}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleHistorySort('lastReceivedAt')}
                  >
                    <div className="flex items-center">
                      Last Received
                      {getSortIcon('lastReceivedAt')}
                    </div>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading
                  ? Array.from({ length: 5 }).map((_, index) => (
                      <TableRow key={`history-skeleton-${index}`}>
                        <TableCell colSpan={10}>
                          <div className="h-4 animate-pulse rounded bg-gray-200" />
                        </TableCell>
                      </TableRow>
                    ))
                  : sortedHistoryRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10}>
                          <div className="py-8 text-center text-sm text-gray-500">
                            No received orders in this period. Adjust the filters to broaden your search.
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedHistoryRows.map((row) => (
                        <TableRow key={row.orderId} className="hover:bg-indigo-50/40">
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-semibold text-gray-900 text-xs">{row.orderNo}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-gray-700">{row.sellerOrgName || '—'}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                              {formatNumber(row.casesScanned)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium text-blue-900 text-xs">{formatNumber(row.unitsScanned)}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                              {formatNumber(row.casesReceived)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium text-gray-900 text-xs">{formatNumber(row.unitsReceived)}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-purple-50 text-purple-700 border-purple-200 text-[10px]">
                              {formatNumber(row.casesShipped)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium text-purple-900 text-xs">{formatNumber(row.unitsShipped)}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-gray-600">{formatDateTime(row.firstReceivedAt)}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-gray-600">{formatDateTime(row.lastReceivedAt)}</span>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-gray-600">
              {historyTotal === 0
                ? 'No records to display'
                : `Showing ${historyPageStart} – ${historyPageEnd} of ${historyTotal} record${historyTotal === 1 ? '' : 's'}`}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHistoryPage((previous) => Math.max(previous - 1, 1))}
                disabled={historyPage <= 1 || historyLoading}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Previous
              </Button>
              <span className="text-sm text-gray-600">
                Page {historyTotalPages === 0 ? 0 : historyPage} of {historyTotalPages || 1}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHistoryPage((previous) => Math.min(previous + 1, historyTotalPages || previous + 1))}
                disabled={historyPage >= (historyTotalPages || 1) || historyLoading}
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Selected Distributor Scan History
            </CardTitle>
            <p className="text-sm text-gray-500">
              Product shipments for the distributor selected above.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                {selectedDistributor ? (
                  <p className="text-sm text-gray-600">
                    Showing products shipped to selected distributor.
                  </p>
                ) : (
                  <p className="text-sm text-gray-500">
                    Select a distributor to view shipment history.
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={loadScanHistory}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead 
                      className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleDistributorSort('variantName')}
                    >
                      <div className="flex items-center">
                        Product
                        {getDistributorSortIcon('variantName')}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleDistributorSort('distributorName')}
                    >
                      <div className="flex items-center">
                        Distributor
                        {getDistributorSortIcon('distributorName')}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleDistributorSort('units')}
                    >
                      <div className="flex items-center">
                        Units
                        {getDistributorSortIcon('units')}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleDistributorSort('lastScanned')}
                    >
                      <div className="flex items-center">
                        Scanned At
                        {getDistributorSortIcon('lastScanned')}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleDistributorSort('status')}
                    >
                      <div className="flex items-center">
                        Status
                        {getDistributorSortIcon('status')}
                      </div>
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase text-gray-500">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggregatedDistributorHistory.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                        <Box className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                        <p>{selectedDistributor ? 'No scans for this distributor yet' : 'No distributor selected'}</p>
                        <p className="text-sm text-gray-400 mt-1">
                          {selectedDistributor ? 'Scan codes above to begin tracking shipments.' : 'Choose a distributor from the dropdown above.'}
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedDistributorHistory.map((data) => (
                      <TableRow key={data.product} className="hover:bg-gray-50">
                        <TableCell className="py-3 px-4 text-sm font-medium text-gray-900">
                          <div className="flex items-center gap-3">
                            {data.imageUrl ? (
                              <img 
                                src={data.imageUrl} 
                                alt={data.variantName} 
                                className="h-10 w-10 rounded-md object-cover border border-gray-200"
                              />
                            ) : (
                              <div className="h-10 w-10 rounded-md bg-gray-100 flex items-center justify-center border border-gray-200">
                                <Box className="h-5 w-5 text-gray-400" />
                              </div>
                            )}
                            <div className="flex flex-col">
                              {(() => {
                                const parts = data.variantName.split('[')
                                if (parts.length > 1) {
                                  return (
                                    <>
                                      <span className="text-xs font-medium text-gray-900">{parts[0].trim()}</span>
                                      <span className="text-[10px] text-gray-500">[{parts[1]}</span>
                                    </>
                                  )
                                }
                                return <span className="text-xs font-medium text-gray-900">{data.variantName}</span>
                              })()}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 px-4 text-xs text-gray-700">
                          {data.distributorName}
                        </TableCell>
                        <TableCell className="py-3 px-4">
                          <span className="text-xs font-semibold text-blue-600">
                            {data.units} units
                          </span>
                        </TableCell>
                        <TableCell className="py-3 px-4 text-xs text-gray-600">
                          {data.lastScanned ? new Date(data.lastScanned).toLocaleString() : '-'}
                        </TableCell>
                        <TableCell className="py-3 px-4">{renderStatusBadge(data.status)}</TableCell>
                        <TableCell className="py-3 px-4">
                          {data.status === 'warehouse_packed' && data.validation_status !== 'approved' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleUnlinkProduct(data.sessionIds, data.product)}
                              disabled={unlinking === data.product}
                              className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                            >
                              {unlinking === data.product ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                <>
                                  <Unlink className="h-3 w-3 mr-1" />
                                  Unlink
                                </>
                              )}
                            </Button>
                          ) : (
                            <span className="text-xs text-gray-400">
                              {data.status === 'shipped_distributor' ? 'Shipped' : '-'}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mt-4">
              <p className="text-sm text-gray-600">
                {aggregatedDistributorHistory.length === 0
                  ? 'No records to display'
                  : `Showing ${((distributorHistoryPage - 1) * ITEMS_PER_PAGE) + 1} – ${Math.min(distributorHistoryPage * ITEMS_PER_PAGE, aggregatedDistributorHistory.length)} of ${aggregatedDistributorHistory.length} record${aggregatedDistributorHistory.length === 1 ? '' : 's'}`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDistributorHistoryPage(p => Math.max(1, p - 1))}
                  disabled={distributorHistoryPage === 1}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-gray-600">
                  Page {distributorHistoryPage} of {Math.ceil(aggregatedDistributorHistory.length / ITEMS_PER_PAGE)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDistributorHistoryPage(p => Math.min(Math.ceil(aggregatedDistributorHistory.length / ITEMS_PER_PAGE), p + 1))}
                  disabled={distributorHistoryPage >= Math.ceil(aggregatedDistributorHistory.length / ITEMS_PER_PAGE)}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Overall Recent Scan History
              </CardTitle>
              <Button variant="outline" size="sm" onClick={loadScanHistory}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4 mb-4">
              <div className="flex-1">
                <Input
                  placeholder="Filter by Order No"
                  value={overallFilterOrderNo}
                  onChange={(e) => setOverallFilterOrderNo(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex-1">
                <Input
                  placeholder="Filter by Distributor"
                  value={overallFilterDistributor}
                  onChange={(e) => setOverallFilterDistributor(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex-1">
                <Input
                  placeholder="Filter by Product Variant"
                  value={overallFilterProduct}
                  onChange={(e) => setOverallFilterProduct(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="w-32">
                <Input
                  placeholder="MMYY"
                  value={overallFilterDate}
                  onChange={(e) => setOverallFilterDate(e.target.value)}
                  className="h-8 text-xs"
                  maxLength={4}
                />
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead 
                      className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleOverallSort('variantName')}
                    >
                      <div className="flex items-center">
                        Product
                        {getOverallSortIcon('variantName')}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleOverallSort('distributor')}
                    >
                      <div className="flex items-center">
                        Distributor
                        {getOverallSortIcon('distributor')}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleOverallSort('units')}
                    >
                      <div className="flex items-center">
                        Units
                        {getOverallSortIcon('units')}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleOverallSort('lastScanned')}
                    >
                      <div className="flex items-center">
                        Scanned At
                        {getOverallSortIcon('lastScanned')}
                      </div>
                    </TableHead>
                    <TableHead 
                      className="text-xs font-medium uppercase text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleOverallSort('status')}
                    >
                      <div className="flex items-center">
                        Status
                        {getOverallSortIcon('status')}
                      </div>
                    </TableHead>
                    <TableHead className="text-xs font-medium uppercase text-gray-500">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggregatedOverallHistory.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                        <Box className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                        <p>No scan history yet</p>
                        <p className="text-sm text-gray-400 mt-1">
                          Start scanning master cases to track warehouse shipments.
                        </p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedOverallHistory.map((data, idx) => (
                      <TableRow key={idx} className="hover:bg-gray-50">
                        <TableCell className="py-3 px-4 text-sm font-medium text-gray-900">
                          <div className="flex items-center gap-3">
                            {data.imageUrl ? (
                              <img 
                                src={data.imageUrl} 
                                alt={data.variantName} 
                                className="h-10 w-10 rounded-md object-cover border border-gray-200"
                              />
                            ) : (
                              <div className="h-10 w-10 rounded-md bg-gray-100 flex items-center justify-center border border-gray-200">
                                <Box className="h-5 w-5 text-gray-400" />
                              </div>
                            )}
                            <div className="flex flex-col">
                              {(() => {
                                const parts = data.variantName.split('[')
                                if (parts.length > 1) {
                                  return (
                                    <>
                                      <span className="text-xs font-medium text-gray-900">{parts[0].trim()}</span>
                                      <span className="text-[10px] text-gray-500">[{parts[1]}</span>
                                    </>
                                  )
                                }
                                return <span className="text-xs font-medium text-gray-900">{data.variantName}</span>
                              })()}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 px-4 text-xs text-gray-700">
                          <div>{data.distributor}</div>
                          {data.orderNos && data.orderNos.length > 0 ? (
                            <div className="text-[10px] text-gray-500 mt-1">
                              {data.orderNos.join(', ')}
                            </div>
                          ) : (
                            <div className="text-[10px] text-gray-400 mt-1 italic">
                              No Order #
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-3 px-4">
                          <span className="text-xs font-semibold text-blue-600">
                            {data.units} units
                          </span>
                        </TableCell>
                        <TableCell className="py-3 px-4 text-xs text-gray-600">
                          {data.lastScanned ? new Date(data.lastScanned).toLocaleString() : '-'}
                        </TableCell>
                        <TableCell className="py-3 px-4">{renderStatusBadge(data.status)}</TableCell>
                        <TableCell className="py-3 px-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUnlinkProduct(data.sessionIds, data.product)}
                            disabled={data.status === 'shipped_distributor' || unlinking === data.product}
                            className="text-orange-600 hover:text-orange-700 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                          >
                            {unlinking === data.product ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <>
                                <Unlink className="h-3 w-3 mr-1" />
                                Unlink
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mt-4">
              <p className="text-sm text-gray-600">
                {aggregatedOverallHistory.length === 0
                  ? 'No records to display'
                  : `Showing ${((overallHistoryPage - 1) * ITEMS_PER_PAGE) + 1} – ${Math.min(overallHistoryPage * ITEMS_PER_PAGE, aggregatedOverallHistory.length)} of ${aggregatedOverallHistory.length} record${aggregatedOverallHistory.length === 1 ? '' : 's'}`}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOverallHistoryPage(p => Math.max(1, p - 1))}
                  disabled={overallHistoryPage === 1}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-gray-600">
                  Page {overallHistoryPage} of {Math.ceil(aggregatedOverallHistory.length / ITEMS_PER_PAGE)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOverallHistoryPage(p => Math.min(Math.ceil(aggregatedOverallHistory.length / ITEMS_PER_PAGE), p + 1))}
                  disabled={overallHistoryPage >= Math.ceil(aggregatedOverallHistory.length / ITEMS_PER_PAGE)}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    </>
  )
}
