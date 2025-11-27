'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
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
import SimpleProgressTracker from '@/components/dashboard/SimpleProgressTracker'
import type { LucideIcon } from 'lucide-react'
import { 
  Warehouse,
  Factory,
  Scan, 
  Package,
  CheckCircle,
  Truck as TruckIcon,
  RefreshCw,
  Activity,
  Store,
  Loader2,
  AlertTriangle,
  Ban,
  Copy,
  XCircle,
  Search,
  ListChecks,
  History as HistoryIcon,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { extractOrderNumber } from '@/lib/qr-code-utils'
import { useToast } from '@/components/ui/use-toast'

interface UserProfile {
  id: string
  email: string
  organization_id: string
  organizations: {
    id: string
    org_name: string
    org_type_code: string
  }
}

interface WarehouseReceiveViewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

type StageKey = 'pending' | 'printed' | 'packed' | 'ready_to_ship' | 'received_warehouse' | 'shipped_distributor' | 'opened'

type OrderSource = 'pending' | 'recent'

interface WarehouseOrderSummary {
  orderId: string
  orderNo: string
  buyerOrgName?: string | null
  readyCases: number
  readyUnits: number
  totalCases?: number
  manufacturingComplete?: boolean
  warehouseIntakeStarted?: boolean
  manufacturerOrgId?: string | null
  warehouseOrgId?: string | null
  receivedCases?: number
  receivedUnits?: number
  lastReceivedAt?: string | null
  source?: OrderSource
}

interface OrderMovementOverview {
  orderId: string
  totalCases: number
  totalUnits: number
  stageCounts: Record<StageKey, number>
  completionScore: number
}

const STAGE_ORDER: StageKey[] = ['pending', 'printed', 'packed', 'ready_to_ship', 'received_warehouse', 'shipped_distributor', 'opened']

const STAGE_WEIGHTS: Record<StageKey, number> = {
  pending: 0,
  printed: 0.15,
  packed: 0.45,
  ready_to_ship: 0.45, // Same as packed - both represent completed manufacturing
  received_warehouse: 0.7,
  shipped_distributor: 0.9,
  opened: 1
}

type ErrorDetails = {
  name?: string
  message?: string
  code?: string
  details?: string
  hint?: string
  stack?: string
}

const extractErrorDetails = (error: unknown): ErrorDetails => {
  if (!error) {
    return { message: 'Unknown error' }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  if (error instanceof Error) {
    const extended = error as Error & { code?: string; details?: string; hint?: string }
    return {
      name: extended.name,
      message: extended.message || 'Unknown error',
      code: extended.code,
      details: extended.details,
      hint: extended.hint,
      stack: extended.stack
    }
  }

  if (typeof error === 'object') {
    const { name, message, code, details, hint, stack } = error as Record<string, any>
    return {
      name: typeof name === 'string' ? name : undefined,
      message: typeof message === 'string' && message.length > 0 ? message : 'Unknown error',
      code: typeof code === 'string' ? code : undefined,
      details: typeof details === 'string' ? details : undefined,
      hint: typeof hint === 'string' ? hint : undefined,
      stack: typeof stack === 'string' ? stack : undefined
    }
  }

  return { message: 'Unknown error' }
}

const buildUserFacingErrorMessage = (details: ErrorDetails): string => {
  const segments = [
    details.message,
    details.code ? `Code: ${details.code}` : undefined,
    details.hint
  ].filter(Boolean)

  return segments.length > 0 ? segments.join(' • ') : 'An unexpected error occurred.'
}

function createEmptyStageCounts(): Record<StageKey, number> {
  return {
    pending: 0,
    printed: 0,
    packed: 0,
    ready_to_ship: 0,
    received_warehouse: 0,
    shipped_distributor: 0,
    opened: 0
  }
}

type ReceiveOutcomeType =
  | 'received'
  | 'already_received'
  | 'wrong_order'
  | 'not_found'
  | 'invalid_status'
  | 'error'
  | 'duplicate_request'
  | 'invalid_format'

interface ReceiveCaseInfo {
  id: string
  master_code: string
  case_number: number | null
  status: string
  product_count: number
  warehouse_received_at: string | null
  variants?: Array<{ variant_id: string; quantity: number; movement_id: string | null }>
}

interface ReceiveMasterResult {
  master_code: string
  normalized_code: string
  outcome: ReceiveOutcomeType
  message: string
  order_id?: string | null
  warehouse_org_id?: string | null
  case_info?: ReceiveCaseInfo
  received_at?: string | null
  details?: unknown
}

interface ReceiveBatchSummary {
  total: number
  received: number
  alreadyReceived: number
  wrongOrder: number
  notFound: number
  invalidStatus: number
  duplicateRequest: number
  invalidFormat: number
  errors: number
}

interface ParsedBatchInputStats {
  rawTokens: string[]
  normalizedTokens: string[]
  uniqueCount: number
  duplicateCount: number
  invalidCount: number
}

const normalizeMasterInput = (value: string): string | null => {
  let token = value.trim()
  if (!token) return null
  if (token.includes('/track/')) {
    const parts = token.split('/')
    token = parts[parts.length - 1] || token
  }
  const normalized = token.trim()
  return normalized.length > 0 ? normalized : null
}

const parseBatchMasterInput = (raw: string): ParsedBatchInputStats => {
  const rawTokens: string[] = []

  raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .forEach(line => {
      if (!line) return
      line
        .split(/[\t,;]/)
        .map(segment => segment.trim())
        .forEach(segment => {
          if (!segment) return
          rawTokens.push(segment)
        })
    })

  const normalizedTokens: string[] = []
  let invalidCount = 0
  const seen = new Set<string>()
  let duplicateCount = 0

  for (const token of rawTokens) {
    const normalized = normalizeMasterInput(token)
    if (!normalized) {
      invalidCount += 1
      continue
    }

    normalizedTokens.push(normalized)

    if (seen.has(normalized)) {
      duplicateCount += 1
    } else {
      seen.add(normalized)
    }
  }

  return {
    rawTokens,
    normalizedTokens,
    uniqueCount: seen.size,
    duplicateCount,
    invalidCount
  }
}

const BATCH_RESULT_PRESENTATION: Record<ReceiveOutcomeType, { label: string; badgeClass: string; iconClass: string; icon: LucideIcon }> = {
  received: {
    label: 'Received',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    iconClass: 'text-emerald-600',
    icon: CheckCircle
  },
  already_received: {
    label: 'Already received',
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
    iconClass: 'text-sky-600',
    icon: RefreshCw
  },
  wrong_order: {
    label: 'Wrong order',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    iconClass: 'text-rose-600',
    icon: Ban
  },
  not_found: {
    label: 'Not found',
    badgeClass: 'bg-slate-50 text-slate-700 border-slate-200',
    iconClass: 'text-slate-600',
    icon: Search
  },
  invalid_status: {
    label: 'Invalid status',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    iconClass: 'text-amber-500',
    icon: AlertTriangle
  },
  duplicate_request: {
    label: 'Duplicate in request',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    iconClass: 'text-indigo-500',
    icon: Copy
  },
  invalid_format: {
    label: 'Invalid format',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
    iconClass: 'text-orange-500',
    icon: AlertTriangle
  },
  error: {
    label: 'Processing error',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    iconClass: 'text-rose-600',
    icon: XCircle
  }
}

type HistoryPreset = 'today' | 'last7' | 'last30' | 'all'

interface IntakeHistoryRow {
  orderId: string
  orderNo: string
  buyerOrgName: string | null
  casesReceived: number
  unitsReceived: number
  casesScanned: number
  unitsScanned: number
  casesShipped: number    // NEW: Cases shipped to distributors
  unitsShipped: number    // NEW: Units shipped to distributors
  firstReceivedAt: string | null
  lastReceivedAt: string | null
}

type HistorySortColumn = 'orderNo' | 'buyerOrgName' | 'casesReceived' | 'unitsReceived' | 'casesScanned' | 'unitsScanned' | 'casesShipped' | 'unitsShipped' | 'firstReceivedAt' | 'lastReceivedAt'
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

export default function WarehouseReceiveView({ userProfile, onViewChange }: WarehouseReceiveViewProps) {
  const [masterCodeInput, setMasterCodeInput] = useState('')
  const [receiving, setReceiving] = useState(false)
  const [batchInput, setBatchInput] = useState('')
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [batchResults, setBatchResults] = useState<ReceiveMasterResult[]>([])
  const [batchSummary, setBatchSummary] = useState<ReceiveBatchSummary | null>(null)
  const [receivedToday, setReceivedToday] = useState<any[]>([])
  const [recentCompletedOrders, setRecentCompletedOrders] = useState<WarehouseOrderSummary[]>([])
  const [pendingMasterCodes, setPendingMasterCodes] = useState<any[]>([])
  const [eligibleOrders, setEligibleOrders] = useState<WarehouseOrderSummary[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState<string>('')
  const [orderOverview, setOrderOverview] = useState<OrderMovementOverview | null>(null)
  const [movementLoading, setMovementLoading] = useState(false)
  const [receivedTodayError, setReceivedTodayError] = useState<string | null>(null)
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
  const { toast } = useToast()
  const supabase = createClient()

  const needsOrderNumberResolution = (label?: string | null) => {
    if (!label) return true
    const normalized = label.trim()
    if (!normalized) return true
    if (normalized === 'Unknown Order' || normalized === 'Unlinked Batch') return true
    if (/^Order\s+[a-f0-9]{8}$/i.test(normalized)) return true
    return false
  }

  const buildOrderLabel = (orderId?: string | null, orderNo?: string | null, masterCode?: string | null) => {
    const normalizedOrderNo = orderNo?.trim()
    if (normalizedOrderNo && !needsOrderNumberResolution(normalizedOrderNo)) {
      return normalizedOrderNo
    }

    const parsedFromMaster = masterCode ? extractOrderNumber(masterCode) : null
    if (parsedFromMaster && !needsOrderNumberResolution(parsedFromMaster)) {
      return parsedFromMaster
    }

    if (orderId) {
      return `Order ${orderId.slice(0, 8)}`
    }
    return 'Unlinked Batch'
  }

  const handleHistorySort = (column: HistorySortColumn) => {
    if (historySortColumn === column) {
      // Toggle direction if same column
      setHistorySortDirection(historySortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // New column, default to descending for numbers/dates, ascending for text
      setHistorySortColumn(column)
      setHistorySortDirection(
        column === 'orderNo' || column === 'buyerOrgName' ? 'asc' : 'desc'
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

  const fetchOrderNumberMap = async (orderIds: string[]): Promise<Map<string, string>> => {
    const uniqueIds = Array.from(new Set(orderIds.filter((id): id is string => typeof id === 'string' && id.length > 0)))
    if (uniqueIds.length === 0) {
      return new Map()
    }

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_no')
        .in('id', uniqueIds)

      if (error) {
        console.error('Failed to resolve order numbers', error)
        return new Map()
      }

      const map = new Map<string, string>()
      ;(data || []).forEach((row: any) => {
        if (row?.id && row?.order_no) {
          map.set(row.id, row.order_no)
        }
      })
      return map
    } catch (err) {
      console.error('Error resolving order numbers', err)
      return new Map()
    }
  }

  const selectableOrders = useMemo(() => {
    const map = new Map<string, WarehouseOrderSummary>()

    eligibleOrders.forEach((order) => {
      map.set(order.orderId, {
        ...order,
        source: order.source ?? 'pending'
      })
    })

    recentCompletedOrders.forEach((order) => {
      if (map.has(order.orderId)) return
      map.set(order.orderId, {
        ...order,
        source: order.source ?? 'recent'
      })
    })

    return Array.from(map.values()).sort((a, b) => {
      const sourcePriority = (order: WarehouseOrderSummary) => (order.source === 'pending' ? 0 : 1)
      const priorityDiff = sourcePriority(a) - sourcePriority(b)
      if (priorityDiff !== 0) return priorityDiff

      if (a.source === 'pending' && b.source === 'pending') {
        return (b.readyCases ?? 0) - (a.readyCases ?? 0)
      }

      const aDate = a.lastReceivedAt ? new Date(a.lastReceivedAt).getTime() : 0
      const bDate = b.lastReceivedAt ? new Date(b.lastReceivedAt).getTime() : 0
      return bDate - aDate
    })
  }, [eligibleOrders, recentCompletedOrders])

  const selectedOrderSummary = useMemo(() => {
    if (!selectedOrderId) return null
    return selectableOrders.find((order) => order.orderId === selectedOrderId) || null
  }, [selectableOrders, selectedOrderId])

  const pendingForSelectedOrder = useMemo(() => {
    if (!selectedOrderId) return pendingMasterCodes
    return pendingMasterCodes.filter((item: any) => {
      const orderId = item.order_id || item.qr_batches?.order_id
      return orderId === selectedOrderId
    })
  }, [pendingMasterCodes, selectedOrderId])

  const receivedForSelectedOrder = useMemo(() => {
    if (!selectedOrderId) return receivedToday
    return receivedToday.filter((item: any) => item.order_id === selectedOrderId)
  }, [receivedToday, selectedOrderId])

  const otherReadyOrders = useMemo(() => {
    return eligibleOrders.filter((order) => order.orderId !== selectedOrderId)
  }, [eligibleOrders, selectedOrderId])

  const fallbackReadyCases = selectedOrderSummary?.readyCases ?? 0
  const fallbackReceivedCases = selectedOrderSummary?.receivedCases ?? fallbackReadyCases
  const fallbackTotalUnits = selectedOrderSummary?.readyUnits ?? selectedOrderSummary?.receivedUnits ?? 0

  const totalCases = orderOverview?.totalCases ?? (fallbackReceivedCases || fallbackReadyCases)
  const receivedCases = orderOverview?.stageCounts.received_warehouse ?? fallbackReceivedCases
  // Combine 'packed' and 'ready_to_ship' - both represent cases completed at manufacturer
  const readyCases = orderOverview ? (orderOverview.stageCounts.packed + orderOverview.stageCounts.ready_to_ship) : fallbackReadyCases
  const totalUnits = orderOverview?.totalUnits ?? fallbackTotalUnits
  const warehouseCompletion = totalCases > 0 ? Math.round((receivedCases / totalCases) * 100) : 0
  const batchInputStats = useMemo(() => parseBatchMasterInput(batchInput), [batchInput])
  const hasBatchEntries = batchInputStats.rawTokens.length > 0
  const batchSummaryChips = useMemo(() => {
    if (!batchSummary) return []
    const items = [
      { key: 'received', label: 'Received', value: batchSummary.received, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
      { key: 'alreadyReceived', label: 'Already received', value: batchSummary.alreadyReceived, className: 'bg-sky-50 text-sky-700 border-sky-200' },
      { key: 'duplicateRequest', label: 'Duplicates', value: batchSummary.duplicateRequest, className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
      { key: 'wrongOrder', label: 'Wrong order', value: batchSummary.wrongOrder, className: 'bg-rose-50 text-rose-700 border-rose-200' },
      { key: 'invalidStatus', label: 'Invalid status', value: batchSummary.invalidStatus, className: 'bg-amber-50 text-amber-700 border-amber-200' },
      { key: 'notFound', label: 'Not found', value: batchSummary.notFound, className: 'bg-slate-50 text-slate-700 border-slate-200' },
      { key: 'invalidFormat', label: 'Invalid format', value: batchSummary.invalidFormat, className: 'bg-orange-50 text-orange-700 border-orange-200' },
      { key: 'errors', label: 'Errors', value: batchSummary.errors, className: 'bg-rose-50 text-rose-700 border-rose-200' }
    ]

    return items.filter(item => item.value > 0)
  }, [batchSummary])

  const historyPageStart = historyRows.length === 0 ? 0 : (historyPage - 1) * historyPageSize + 1
  const historyPageEnd = historyRows.length === 0 ? 0 : historyPageStart + historyRows.length - 1

  const pipelineSteps = useMemo(() => {
    if (!orderOverview || orderOverview.totalCases === 0) return []
    const { stageCounts, totalCases } = orderOverview
    const percentFor = (value: number) => totalCases === 0 ? 0 : Math.round((value / totalCases) * 1000) / 10

    const cumulativeCounts = STAGE_ORDER.reduce((acc, stage, index) => {
      const remainingStages = STAGE_ORDER.slice(index)
      acc[stage] = remainingStages.reduce((sum, key) => sum + (stageCounts[key] ?? 0), 0)
      return acc
    }, {} as Record<StageKey, number>)

    return [
      {
        key: 'packed',
        label: 'Packed @ Manufacturer',
        icon: Factory,
        count: cumulativeCounts.packed,
        percent: percentFor(cumulativeCounts.packed),
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
        borderColor: 'border-blue-100'
      },
      {
        key: 'received_warehouse',
        label: 'Received @ Warehouse',
        icon: Warehouse,
        count: cumulativeCounts.received_warehouse,
        percent: percentFor(cumulativeCounts.received_warehouse),
        color: 'text-indigo-600',
        bgColor: 'bg-indigo-50',
        borderColor: 'border-indigo-100'
      },
      {
        key: 'shipped_distributor',
        label: 'Shipped to Distributor',
        icon: TruckIcon,
        count: cumulativeCounts.shipped_distributor,
        percent: percentFor(cumulativeCounts.shipped_distributor),
        color: 'text-amber-600',
        bgColor: 'bg-amber-50',
        borderColor: 'border-amber-100'
      },
      {
        key: 'opened',
        label: 'Reached Shop Floor',
        icon: Store,
        count: cumulativeCounts.opened,
        percent: percentFor(cumulativeCounts.opened),
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-50',
        borderColor: 'border-emerald-100'
      }
    ]
  }, [orderOverview])

  useEffect(() => {
    loadPendingBatches()
    loadReceivedToday()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selectedOrderId) {
      loadOrderMovement(selectedOrderId)
    } else {
      setOrderOverview(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrderId])

  useEffect(() => {
    if (!selectedOrderId && selectableOrders.length > 0) {
      setSelectedOrderId(selectableOrders[0].orderId)
    }
  }, [selectedOrderId, selectableOrders])

  useEffect(() => {
    const timeout = setTimeout(() => {
      setHistorySearch(historySearchInput.trim())
      setHistoryPage(1)
    }, 350)

    return () => clearTimeout(timeout)
  }, [historySearchInput])

  useEffect(() => {
    loadIntakeHistory()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyPage, historyRangeParams.start, historyRangeParams.end, historySearch, historyPageSize])

  const loadPendingBatches = async () => {
    try {
      const response = await fetch(`/api/warehouse/pending-receives?warehouse_org_id=${userProfile.organization_id}`)
      if (!response.ok) {
        console.error('Failed to load pending batches:', response.status, response.statusText)
        // Try to get error details from response
        let errorMessage = 'Failed to load pending batches'
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || errorMessage
        } catch {
          // Response is not JSON, use status text
          errorMessage = `${response.status}: ${response.statusText}`
        }
        throw new Error(errorMessage)
      }
      let data = await response.json()

      console.info('[WarehouseReceive] Pending receives API payload', {
        totalMasters: Array.isArray(data) ? data.length : 0,
        sample: Array.isArray(data) && data.length > 0
          ? {
              order_id: data[0]?.order_id || data[0]?.qr_batches?.order_id || null,
              order_no: data[0]?.order_no || null,
              warehouse_org_id: data[0]?.warehouse_org_id ?? null,
              manufacturer_scanned_at: data[0]?.manufacturer_scanned_at || null
            }
          : null
      })

      const grouped = new Map<string, WarehouseOrderSummary>()
      const pendingLookupIds = new Set<string>()
      ;(data || []).forEach((item: any) => {
        const orderId = item.order_id || item.qr_batches?.order_id
        if (!orderId) return

        const manufacturerOrgId = item.seller_org_id || item.qr_batches?.orders?.seller_org_id || null
        const warehouseOrgId = item.warehouse_org_id || null
        const rawOrderNo = item.order_no || item.qr_batches?.orders?.order_no || null
        if ((!rawOrderNo || needsOrderNumberResolution(rawOrderNo)) && orderId) {
          pendingLookupIds.add(orderId)
        }
        const orderNo = buildOrderLabel(orderId, rawOrderNo, item.master_code)

        if (!grouped.has(orderId)) {
          console.debug('[WarehouseReceive] Creating order summary', { orderId, orderNo, hasOrderNo: !!item.order_no })
          grouped.set(orderId, {
            orderId,
            orderNo,
            buyerOrgName: item.buyer_org_name ?? item.qr_batches?.orders?.organizations?.org_name ?? null,
            readyCases: 0,
            readyUnits: 0,
            manufacturerOrgId,
            warehouseOrgId,
            source: 'pending'
          })
        }

        const summary = grouped.get(orderId)!
        summary.readyCases += 1
        summary.readyUnits += item.actual_unit_count || item.expected_unit_count || 0
        if (!summary.manufacturerOrgId && manufacturerOrgId) {
          summary.manufacturerOrgId = manufacturerOrgId
        }
        if (!summary.warehouseOrgId && warehouseOrgId) {
          summary.warehouseOrgId = warehouseOrgId
        }
      })

      const lookupOrderIdList = Array.from(pendingLookupIds)
      if (lookupOrderIdList.length > 0) {
        const resolvedOrderNos = await fetchOrderNumberMap(lookupOrderIdList)
        if (resolvedOrderNos.size > 0) {
          data = (data || []).map((item: any) => {
            const candidateId = item.order_id || item.qr_batches?.order_id
            const resolved = candidateId ? resolvedOrderNos.get(candidateId) : null
            return resolved ? { ...item, order_no: resolved } : item
          })

          grouped.forEach((summary, id) => {
            const resolved = resolvedOrderNos.get(id)
            if (resolved) {
              summary.orderNo = resolved
            }
          })
        }
      }

    setPendingMasterCodes(data)

    const ordersList = Array.from(grouped.values()).sort((a, b) => b.readyCases - a.readyCases)

      let filteredOrders = ordersList

      if (ordersList.length > 0) {
        const overviewResults = await Promise.all(
          ordersList.map(async (order) => {
            try {
              const overview = await fetchOrderMovementOverview(order.orderId)
              console.info('[WarehouseReceive] Movement overview loaded', {
                orderId: order.orderId,
                totalCases: overview?.totalCases ?? 0,
                stageCounts: overview?.stageCounts ?? null
              })
              return { orderId: order.orderId, overview }
            } catch (progressError) {
              console.error('Error loading manufacturing overview for order', order.orderId, progressError)
              return { orderId: order.orderId, overview: null }
            }
          })
        )

        const overviewMap = new Map(overviewResults.map((item) => [item.orderId, item.overview]))

        const filteredOrders = ordersList
          .map((order) => {
            const overview = overviewMap.get(order.orderId)
            if (!overview) {
              return {
                ...order,
                manufacturingComplete: order.readyCases > 0,
                warehouseIntakeStarted: false,
                totalCases: order.totalCases ?? order.readyCases,
                readyCases: order.readyCases,
                  readyUnits: order.readyUnits,
                  source: 'pending'
              }
            }

            const downstreamCases = overview.stageCounts.received_warehouse + overview.stageCounts.shipped_distributor + overview.stageCounts.opened
            const manufacturingComplete = overview.stageCounts.pending === 0 && overview.stageCounts.printed === 0
            // Combine 'packed' and 'ready_to_ship' - both represent cases completed at manufacturer
            const readyCases = overview.stageCounts.packed + overview.stageCounts.ready_to_ship

            return {
              ...order,
              manufacturingComplete,
              warehouseIntakeStarted: downstreamCases > 0,
              totalCases: overview.totalCases,
              readyCases,
                readyUnits: order.readyUnits,
                source: 'pending'
            }
          })
          .filter((order) => order.manufacturingComplete && order.readyCases > 0)
          .sort((a, b) => b.readyCases - a.readyCases)
      }

      if (ordersList.length > 0 && filteredOrders.length === 0) {
        console.warn('[WarehouseReceive] Orders filtered out after overview evaluation', {
          warehouseOrgId: userProfile.organization_id,
          initialOrders: ordersList.map((order) => ({
            orderId: order.orderId,
            readyCases: order.readyCases,
            manufacturerOrgId: order.manufacturerOrgId,
            warehouseOrgId: order.warehouseOrgId
          }))
        })
      }

      console.info('[WarehouseReceive] Eligible orders',
        filteredOrders.map((order) => ({
          orderId: order.orderId,
          readyCases: order.readyCases,
          manufacturingComplete: order.manufacturingComplete,
          warehouseIntakeStarted: order.warehouseIntakeStarted
        }))
      )

      setEligibleOrders(filteredOrders)

      if (filteredOrders.length > 0) {
        const isCurrentStillValid = filteredOrders.some((order) => order.orderId === selectedOrderId)
        
        // FIX: Only auto-select if current selection is invalid
        // Don't auto-switch when user just completed an order
        // This allows user to see "Today's intake activity" for the order they completed
        if (!isCurrentStillValid && !selectedOrderId) {
          // No selection yet - auto-select first available order
          setSelectedOrderId(filteredOrders[0].orderId)
        } else if (!isCurrentStillValid && selectedOrderId) {
          // Current selection is no longer valid (order completed)
          // DON'T auto-switch - let user see the completed order's activity
          // User can manually select next order when ready
          console.log('[WarehouseReceive] Order completed. Keeping selection to view activity.')
        }
        // If current selection is still valid, keep it (already selected)
      }
    } catch (error: any) {
      console.error('Error loading pending batches:', error)
      toast({
        title: 'Error',
        description: `Failed to load pending batches: ${error.message}`,
        variant: 'destructive'
      })
    }
  }

  const loadReceivedToday = async () => {
    try {
      const today = new Date().toISOString().split('T')[0]
      
      // Query for master codes received by this warehouse today
      const { data, error } = await supabase
        .from('qr_master_codes')
        .select(`
          id,
          master_code,
          case_number,
          actual_unit_count,
          expected_unit_count,
          warehouse_received_at,
          status,
          qr_batches!inner (
            id,
            order_id,
            orders (
              id,
              order_no,
              organizations!orders_buyer_org_id_fkey (
                org_name
              )
            )
          )
        `)
        .eq('warehouse_org_id', userProfile.organization_id)
        .gte('warehouse_received_at', `${today}T00:00:00`)
        .not('warehouse_received_at', 'is', null)
        .order('warehouse_received_at', { ascending: false })
        .limit(40)

      if (error) {
        const details = extractErrorDetails(error)
        console.error('Supabase error loading received today:', details, error)
        const message = buildUserFacingErrorMessage(details)
        toast({
          title: "Unable to load today's intake",
          description: message,
          variant: 'destructive'
        })
        setReceivedTodayError(message)
        return
      }
      const pendingLookupIds = new Set<string>()
      let normalized = (data || []).map((item: any) => {
        const batch = Array.isArray(item.qr_batches) ? item.qr_batches[0] : item.qr_batches
        const order = batch?.orders ? (Array.isArray(batch.orders) ? batch.orders[0] : batch.orders) : null
        const buyerOrg = order?.organizations ? (Array.isArray(order.organizations) ? order.organizations[0] : order.organizations) : null

        const orderId = order?.id || batch?.order_id || null
        const rawOrderNo = order?.order_no || null
        if ((!rawOrderNo || needsOrderNumberResolution(rawOrderNo)) && orderId) {
          pendingLookupIds.add(orderId)
        }
  const orderNo = buildOrderLabel(orderId, rawOrderNo, item.master_code)

        return {
          ...item,
          order_id: orderId,
          order_no: orderNo,
          buyer_org_name: buyerOrg?.org_name || null
        }
      })

      const lookupOrderIds = Array.from(pendingLookupIds)
      if (lookupOrderIds.length > 0) {
        const resolvedOrderNos = await fetchOrderNumberMap(lookupOrderIds)
        if (resolvedOrderNos.size > 0) {
          normalized = normalized.map((item: any) => {
            const resolved = item.order_id ? resolvedOrderNos.get(item.order_id) : null
            return resolved ? { ...item, order_no: resolved } : item
          })
        }
      }

      setReceivedTodayError(null)
      setReceivedToday(normalized)

      const summaryMap = new Map<string, WarehouseOrderSummary>()
      normalized.forEach((item: any) => {
        const orderId = item.order_id
        if (!orderId) return

        const units = item.actual_unit_count || item.expected_unit_count || 0
        const displayOrderNo = needsOrderNumberResolution(item.order_no)
          ? buildOrderLabel(orderId, null, item.master_code)
          : item.order_no
        const existing = summaryMap.get(orderId) || {
          orderId,
          orderNo: displayOrderNo,
          buyerOrgName: item.buyer_org_name || null,
          readyCases: 0,
          readyUnits: 0,
          receivedCases: 0,
          receivedUnits: 0,
          lastReceivedAt: null,
          source: 'recent' as OrderSource,
          warehouseOrgId: item.warehouse_org_id || userProfile.organization_id || null,
          manufacturerOrgId: null
        }

        existing.orderNo = displayOrderNo

        existing.receivedCases = (existing.receivedCases || 0) + 1
        existing.receivedUnits = (existing.receivedUnits || 0) + units

        const currentTimestamp = existing.lastReceivedAt ? new Date(existing.lastReceivedAt).getTime() : 0
        const candidateTimestamp = item.warehouse_received_at ? new Date(item.warehouse_received_at).getTime() : 0
        if (candidateTimestamp > currentTimestamp) {
          existing.lastReceivedAt = item.warehouse_received_at || existing.lastReceivedAt
        }

        summaryMap.set(orderId, existing)
      })

      const recentList = Array.from(summaryMap.values()).sort((a, b) => {
        const aTime = a.lastReceivedAt ? new Date(a.lastReceivedAt).getTime() : 0
        const bTime = b.lastReceivedAt ? new Date(b.lastReceivedAt).getTime() : 0
        return bTime - aTime
      })

      setRecentCompletedOrders(recentList)
    } catch (error: unknown) {
      const details = extractErrorDetails(error)
      console.error('Error loading received today:', details, error)
      const message = buildUserFacingErrorMessage(details)
      toast({
        title: "Unable to load today's intake",
        description: message,
        variant: 'destructive'
      })
      setReceivedTodayError(message)
    }
  }

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

      console.log('🔍 [Frontend] Loading intake history with params:', {
        warehouse_org_id: userProfile.organization_id,
        page: nextPage,
        preset: historyPreset,
        start: historyRangeParams.start,
        end: historyRangeParams.end,
        search: historySearch
      })

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

      console.log('🔍 [Frontend] Intake history response:', {
        rowCount: rows.length,
        total,
        totalPages,
        page: resolvedPage
      })

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

  const fetchOrderMovementOverview = async (orderId: string): Promise<OrderMovementOverview | null> => {
    if (!orderId) {
      return null
    }

    console.log('[WarehouseReceive] Fetching movement overview for order:', orderId)

    // Query master codes for the selected order that belong to this warehouse
    // Include all statuses to show complete history (received_warehouse, shipped_distributor, etc.)
    const { data, error } = await supabase
      .from('qr_master_codes')
      .select(`
        id,
        status,
        actual_unit_count,
        expected_unit_count,
        warehouse_received_at,
        warehouse_org_id,
        qr_batches!inner (order_id)
      `)
      .eq('qr_batches.order_id', orderId)
      .eq('warehouse_org_id', userProfile.organization_id)

    if (error) {
      console.error('[WarehouseReceive] Error fetching movement overview:', error)
      throw error
    }

    console.log('[WarehouseReceive] Query returned', data?.length || 0, 'master codes for order', orderId)
    if (data && data.length > 0) {
      console.log('[WarehouseReceive] Master code statuses:', data.map(d => ({ id: d.id, status: d.status, warehouse_org_id: d.warehouse_org_id })))
    }

    const stageCounts = createEmptyStageCounts()
    let totalUnits = 0
    let completionScore = 0

    ;(data || []).forEach((record: any) => {
      // Map statuses to movement tracker stages
      let status: StageKey = 'pending'
      const originalStatus = record.status
      
      if (record.status === 'generated' || record.status === 'packed') {
        // Manufacturing stages
        status = 'packed'
      } else if (record.status === 'warehouse_packed') {
        // Warehouse has packed for shipment but not yet confirmed shipped
        // Show as "Received @ Warehouse" since it's in warehouse possession
        status = 'received_warehouse'
      } else if (record.status && STAGE_ORDER.includes(record.status)) {
        // Standard statuses (received_warehouse, shipped_distributor, opened, etc.)
        status = record.status as StageKey
      }
      
      if (originalStatus !== status) {
        console.log(`[WarehouseReceive] Mapped status '${originalStatus}' → '${status}'`)
      }
      
      stageCounts[status] += 1
      totalUnits += record.actual_unit_count || record.expected_unit_count || 0
      completionScore += STAGE_WEIGHTS[status]
    })

    console.log('[WarehouseReceive] Stage counts for order', orderId, ':', stageCounts)

    if ((data || []).length === 0) {
      console.warn('[WarehouseReceive] No master codes found for overview', {
        orderId,
        userWarehouseOrgId: userProfile.organization_id,
        note: 'Order may not have any master codes linked via qr_batches'
      })
      return null
    }

    return {
      orderId,
      totalCases: (data || []).length,
      totalUnits,
      stageCounts,
      completionScore
    }
  }

  const loadOrderMovement = async (orderId: string) => {
    if (!orderId) {
      setOrderOverview(null)
      return
    }

    try {
      setMovementLoading(true)
      const overview = await fetchOrderMovementOverview(orderId)
      setOrderOverview(overview)
    } catch (error) {
      console.error('Error loading order movement:', error)
      setOrderOverview(null)
    } finally {
      setMovementLoading(false)
    }
  }

  const handleReceiveMaster = async (code: string) => {
    if (!code.trim()) return
    if (!selectedOrderId) {
      toast({
        title: 'Select an order',
        description: 'Choose an order to receive before scanning master codes.',
        variant: 'destructive'
      })
      return
    }

    try {
      setReceiving(true)
      const response = await fetch('/api/warehouse/receive-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_code: code,
          order_id: selectedOrderId,
          warehouse_org_id: userProfile.organization_id,
          user_id: userProfile.id
        })
      })
      let payload: any = {}
      try {
        payload = await response.json()
      } catch (parseError) {
        console.error('Failed to parse receive-master response', parseError)
      }

      const results: ReceiveMasterResult[] = Array.isArray(payload?.results)
        ? payload.results
        : payload?.normalized_code || payload?.master_code
          ? [payload as ReceiveMasterResult]
          : []

      setBatchResults(results)
      setBatchSummary(payload?.summary ?? null)

      const receivedEntry = results.find(item => item.outcome === 'received') || null
      const primaryMessage = receivedEntry?.message || results[0]?.message || payload?.message || 'Failed to receive master case'

      if (!response.ok || !receivedEntry) {
        toast({
          title: 'Error',
          description: primaryMessage,
          variant: 'destructive'
        })
        return
      }

      const caseNumberDisplay = receivedEntry.case_info?.case_number ?? '—'
      const productCountDisplay = receivedEntry.case_info?.product_count ?? 0

      toast({
        title: 'Success',
        description: `Received case ${caseNumberDisplay} with ${productCountDisplay} products`
      })

      setMasterCodeInput('')
      await loadReceivedToday()
      await loadPendingBatches()
      await loadOrderMovement(selectedOrderId)
      await loadIntakeHistory(undefined, { silent: true }) // Refresh history after receiving
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.message || 'Failed to receive master case',
        variant: 'destructive'
      })
    } finally {
      setReceiving(false)
    }
  }

  const handleBatchReceive = async () => {
    if (!selectedOrderId) {
      toast({
        title: 'Select an order',
        description: 'Choose an order to receive before processing a batch.',
        variant: 'destructive'
      })
      return
    }

    if (!hasBatchEntries) {
      toast({
        title: 'No master codes detected',
        description: 'Paste or scan master codes before starting batch receive.',
        variant: 'destructive'
      })
      return
    }

    try {
      setBatchProcessing(true)
      const response = await fetch('/api/warehouse/receive-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_codes: batchInputStats.rawTokens,
          order_id: selectedOrderId,
          warehouse_org_id: userProfile.organization_id,
          user_id: userProfile.id
        })
      })

      let payload: any = {}
      try {
        payload = await response.json()
      } catch (parseError) {
        console.error('Failed to parse batch receive response', parseError)
      }

      const results: ReceiveMasterResult[] = Array.isArray(payload?.results)
        ? payload.results
        : []

      setBatchResults(results)
      setBatchSummary(payload?.summary ?? null)

      const receivedCount = payload?.summary?.received ?? 0

      if (receivedCount > 0) {
        const casesLabel = receivedCount === 1 ? 'case' : 'cases'
        toast({
          title: 'Batch received',
          description: `Recorded ${receivedCount} ${casesLabel} in the warehouse.`
        })

        setBatchInput('')
        await loadReceivedToday()
        await loadPendingBatches()
        if (selectedOrderId) {
          await loadOrderMovement(selectedOrderId)
        }
        await loadIntakeHistory(undefined, { silent: true }) // Refresh history after batch receive
      } else {
        const firstMessage = results[0]?.message || payload?.message || 'No master cases were received.'
        toast({
          title: 'No cases received',
          description: firstMessage,
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      toast({
        title: 'Batch error',
        description: error?.message || 'Failed to process batch receive',
        variant: 'destructive'
      })
    } finally {
      setBatchProcessing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Warehouse Receive</h1>
        <p className="text-gray-600 mt-1">
          Take over manufactured orders and confirm arrival at the warehouse.
        </p>
      </div>

      <Card className="border-indigo-200">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-indigo-900">
            <Activity className="h-5 w-5" />
            Warehouse Intake Control
          </CardTitle>
          <p className="text-sm text-indigo-700">
            Select an order that has completed manufacturing and monitor its movement into the warehouse.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            {eligibleOrders.length === 0 ? (
              selectableOrders.length === 0 ? (
                <>
                  <label className="block text-sm font-medium text-gray-700">
                    Choose order ready for intake
                  </label>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <select
                      value=""
                      disabled={true}
                      className="w-full md:max-w-md px-4 py-2 border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-gray-50"
                    >
                      <option value="">No manufactured orders are ready yet</option>
                    </select>
                  </div>
                  <p className="text-sm text-gray-500">
                    Once manufacturing finishes packing an order, it will appear here for warehouse intake.
                  </p>
                </>
              ) : (
                <>
                  <label className="block text-sm font-medium text-gray-700">
                    Review recent warehouse intake
                  </label>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center">
                    <select
                      value={selectedOrderId}
                      onChange={(e) => setSelectedOrderId(e.target.value)}
                      className="w-full md:max-w-md px-4 py-2 border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">Select an order...</option>
                      {selectableOrders.map((order) => (
                        <option key={order.orderId} value={order.orderId}>
                          {order.orderNo} • {order.receivedCases ?? order.readyCases ?? 0} cases received
                        </option>
                      ))}
                    </select>
                    {selectedOrderSummary && (
                      <Badge variant="outline" className="w-fit bg-indigo-50 text-indigo-700 border-indigo-200">
                        {selectedOrderSummary.receivedCases ?? 0} cases received today
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-emerald-700 flex items-center gap-1">
                    <CheckCircle className="h-4 w-4" />
                    All manufactured orders are received. Movement tracker stays visible for review.
                  </p>
                </>
              )
            ) : eligibleOrders.length === 1 ? (
              <>
                <label className="block text-sm font-medium text-gray-700">
                  Order auto-loaded for intake
                </label>
                <div className="flex flex-col gap-3 p-4 bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-300 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-emerald-600" />
                        <span className="text-lg font-semibold text-gray-900">
                          {selectedOrderSummary?.orderNo}
                        </span>
                      </div>
                      {selectedOrderSummary?.buyerOrgName && (
                        <p className="text-sm text-gray-600 mt-1 ml-7">
                          For {selectedOrderSummary.buyerOrgName}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Badge variant="outline" className="bg-blue-100 text-blue-700 border-blue-300">
                            {(selectedOrderSummary?.readyCases ?? selectedOrderSummary?.receivedCases ?? 0)} cases ready
                      </Badge>
                      <Badge variant="outline" className="bg-indigo-100 text-indigo-700 border-indigo-300">
                            {(selectedOrderSummary?.readyUnits ?? selectedOrderSummary?.receivedUnits ?? 0).toLocaleString()} units
                      </Badge>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-emerald-700 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" />
                  Only one completed batch available—automatically loaded for receiving
                </p>
              </>
            ) : (
              <>
                <label className="block text-sm font-medium text-gray-700">
                  Choose order ready for intake ({eligibleOrders.length} available)
                </label>
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <select
                    value={selectedOrderId}
                    onChange={(e) => setSelectedOrderId(e.target.value)}
                    className="w-full md:max-w-md px-4 py-2 border border-indigo-200 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select an order to receive...</option>
                    {eligibleOrders.map((order) => (
                      <option key={order.orderId} value={order.orderId}>
                        {order.orderNo} • {order.readyCases} cases ready • {order.readyUnits.toLocaleString()} units
                      </option>
                    ))}
                  </select>

                  {selectedOrderSummary && (
                    <Badge variant="outline" className="w-fit bg-indigo-50 text-indigo-700 border-indigo-200">
                      {(selectedOrderSummary.readyCases ?? selectedOrderSummary.receivedCases ?? 0)} cases • {(selectedOrderSummary.readyUnits ?? selectedOrderSummary.receivedUnits ?? 0).toLocaleString()} units
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-amber-700 flex items-center gap-1">
                  <Activity className="h-4 w-4" />
                  Multiple batches ready—select which one to receive first
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
              <p className="text-xs uppercase tracking-wide text-blue-500">Cases ready for warehouse</p>
              <p className="mt-2 text-2xl font-semibold text-blue-900">{readyCases}</p>
              <p className="text-xs text-blue-600">Packed &amp; awaiting receiving</p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-xs uppercase tracking-wide text-emerald-500">Cases received</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-900">{receivedCases}</p>
              <p className="text-xs text-emerald-600">Confirmed in warehouse</p>
            </div>
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
              <p className="text-xs uppercase tracking-wide text-indigo-500">Units accounted for</p>
              <p className="mt-2 text-2xl font-semibold text-indigo-900">{totalUnits.toLocaleString()}</p>
              <p className="text-xs text-indigo-600">Across selected order</p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-gray-500">Warehouse completion</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{warehouseCompletion}%</p>
              <Progress value={warehouseCompletion} className="mt-3 h-2" />
              <p className="text-xs text-gray-500 mt-2">Received vs total master cases</p>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="text-sm font-semibold text-gray-900">Product movement tracker</h4>
              {movementLoading && (
                <span className="flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Updating movement data...
                </span>
              )}
            </div>
            {pipelineSteps.length > 0 ? (
              <SimpleProgressTracker
                steps={pipelineSteps}
                totalCases={orderOverview?.totalCases || 0}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-gray-500">
                {selectedOrderId
                  ? 'Movement data will appear once the first master case is received for this order.'
                  : 'Select an order to visualise its journey from manufacturer to warehouse.'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scan className="h-5 w-5" />
              Receive master cases
            </CardTitle>
            {selectedOrderSummary && (
              <p className="text-sm text-gray-500">
                Receiving for <span className="font-semibold text-gray-900">{selectedOrderSummary.orderNo}</span> • {selectedOrderSummary.readyCases} cases ready.
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedOrderId && eligibleOrders.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Select an order above to start batch receiving master case QR codes.
              </div>
            )}

            <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-indigo-900">Batch paste master codes</h4>
                  <p className="text-xs text-indigo-700 mt-1">
                    Paste or scan multiple master codes separated by new lines, commas, or spaces. Duplicates are detected automatically.
                  </p>
                </div>
                <Badge variant="outline" className="bg-indigo-600/10 border-indigo-500 text-indigo-800">
                  Batch
                </Badge>
              </div>

              <textarea
                value={batchInput}
                onChange={(e) => setBatchInput(e.target.value)}
                placeholder={selectedOrderId ? 'Paste master QR codes here...' : 'Select an order to enable batch receiving'}
                className="w-full min-h-[120px] rounded-md border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                disabled={batchProcessing || !selectedOrderId}
              />

              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between text-xs text-indigo-700">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1">
                    <ListChecks className="h-4 w-4" />
                    {batchInputStats.normalizedTokens.length} detected
                  </span>
                  <span className="flex items-center gap-1">
                    <Copy className="h-4 w-4" />
                    {batchInputStats.uniqueCount} unique
                  </span>
                  {batchInputStats.duplicateCount > 0 && (
                    <span className="flex items-center gap-1 text-amber-600">
                      <AlertTriangle className="h-4 w-4" />
                      {batchInputStats.duplicateCount} duplicates
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {batchResults.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setBatchResults([])
                        setBatchSummary(null)
                      }}
                      className="text-indigo-700 hover:text-indigo-900"
                    >
                      Clear summary
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBatchInput('')}
                    disabled={batchProcessing || batchInput.length === 0}
                  >
                    Reset input
                  </Button>
                  <Button
                    onClick={handleBatchReceive}
                    disabled={batchProcessing || !hasBatchEntries || !selectedOrderId}
                    size="sm"
                    className="bg-indigo-600 text-white hover:bg-indigo-700"
                  >
                    {batchProcessing ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      'Receive all'
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {batchResults.length > 0 && (
              <div className="space-y-3 rounded-lg border border-indigo-200 bg-white/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">Last batch results</h4>
                    {batchSummary && (
                      <p className="text-xs text-gray-500 mt-1">
                        {batchSummary.received}/{batchSummary.total} received • {batchSummary.duplicateRequest} duplicate{batchSummary.duplicateRequest === 1 ? '' : 's'} skipped
                      </p>
                    )}
                  </div>
                  {batchSummary && (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                      {batchSummary.received} new case{batchSummary.received === 1 ? '' : 's'}
                    </Badge>
                  )}
                </div>

                {batchSummaryChips.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {batchSummaryChips.map((chip) => (
                      <span key={chip.key} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${chip.className}`}>
                        {chip.label}
                        <span className="font-semibold">{chip.value}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                  <div className="divide-y divide-gray-100">
                    {batchResults.map((result, index) => {
                      const presentation = BATCH_RESULT_PRESENTATION[result.outcome]
                      const OutcomeIcon = presentation?.icon ?? CheckCircle
                      return (
                        <div key={`${result.normalized_code}-${index}`} className="flex items-start gap-3 p-3">
                          <OutcomeIcon className={`h-5 w-5 flex-shrink-0 ${presentation?.iconClass || 'text-gray-500'}`} />
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-sm text-gray-900">{result.normalized_code || result.master_code}</span>
                              {presentation && (
                                <Badge variant="outline" className={`text-[11px] ${presentation.badgeClass}`}>
                                  {presentation.label}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-gray-600">{result.message}</p>
                            {result.case_info?.product_count !== undefined && result.case_info?.case_number !== undefined && (
                              <p className="mt-1 text-[11px] text-gray-500">
                                Case #{result.case_info.case_number ?? '—'} • {result.case_info.product_count} units
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-900 mb-2">Quick tips</h4>
              <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                <li>Scan only the master case QR code (child units move automatically).</li>
                <li>Once the target cases are received, the order moves to the next stage of the tracker.</li>
                <li>Need to pause? Select a different order anytime—progress is saved.</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s intake activity</CardTitle>
            <p className="text-sm text-gray-500">
              {selectedOrderId ? `Filtered for ${selectedOrderSummary?.orderNo ?? 'selected order'}` : 'All warehouse receipts today'}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {receivedTodayError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {receivedTodayError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="text-sm text-gray-600">Cases received today</p>
                <p className="text-3xl font-bold text-green-700">{receivedForSelectedOrder.length}</p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="text-sm text-gray-600">Units confirmed</p>
                <p className="text-3xl font-bold text-blue-700">
                  {receivedForSelectedOrder.reduce((sum, item) => sum + (item.actual_unit_count || item.expected_unit_count || 0), 0).toLocaleString()}
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-2">Recent receives</h4>
              <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
                {receivedForSelectedOrder.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <Package className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                    <p>No master cases received for this selection yet today.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {receivedForSelectedOrder.map((item: any) => (
                      <div key={item.id} className="p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-900">Case #{item.case_number}</p>
                            <p className="text-xs text-gray-500">{item.order_no}</p>
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {item.actual_unit_count || item.expected_unit_count || 0} units
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {item.warehouse_received_at ? new Date(item.warehouse_received_at).toLocaleTimeString() : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-indigo-100">
        <CardHeader className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 justify-between">
              <CardTitle className="flex items-center gap-2 text-indigo-900">
                <HistoryIcon className="h-5 w-5" />
                Warehouse intake history
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
                    onClick={() => handleHistorySort('buyerOrgName')}
                  >
                    <div className="flex items-center">
                      Buyer
                      {getSortIcon('buyerOrgName')}
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
                              <span className="font-semibold text-gray-900">{row.orderNo}</span>
                              <span className="text-xs text-gray-500">{row.orderId.slice(0, 8)}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-gray-700">{row.buyerOrgName || '—'}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200">
                              {formatNumber(row.casesScanned)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium text-blue-900">{formatNumber(row.unitsScanned)}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                              {formatNumber(row.casesReceived)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium text-gray-900">{formatNumber(row.unitsReceived)}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-purple-50 text-purple-700 border-purple-200">
                              {formatNumber(row.casesShipped)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium text-purple-900">{formatNumber(row.unitsShipped)}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-gray-600">{formatDateTime(row.firstReceivedAt)}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-gray-600">{formatDateTime(row.lastReceivedAt)}</span>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            Pending master cases
          </CardTitle>
          {otherReadyOrders.length > 0 && (
            <p className="text-xs text-gray-500">
              {otherReadyOrders.length} additional order{otherReadyOrders.length === 1 ? ' is' : 's are'} waiting: {otherReadyOrders.map((order) => order.orderNo).join(', ')}.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {eligibleOrders.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CheckCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              All master cases are up to date. Check back when the next manufacturing batch is ready.
            </div>
          ) : pendingForSelectedOrder.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-4" />
              All cases for this order are received. Switch to another order to continue intake.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Case #</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Master code</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Units</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Packed at</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pendingForSelectedOrder.map((item: any) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">#{item.case_number}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 font-mono truncate max-w-[18rem]">
                        {item.master_code}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {item.actual_unit_count || item.expected_unit_count || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {item.manufacturer_scanned_at ? new Date(item.manufacturer_scanned_at).toLocaleString() : 'Awaiting update'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
