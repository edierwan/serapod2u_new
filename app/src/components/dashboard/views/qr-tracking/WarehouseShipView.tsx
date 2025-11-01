'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Scan, Truck, ShieldCheck, AlertTriangle, ListChecks, ClipboardPaste, X, History, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'
import BatchProcessingModal from './BatchProcessingModal'

interface UserProfile {
  id: string
  email: string
  organization_id: string
  organizations: {
    id: string
    org_name: string
  }
}

interface WarehouseShipViewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

type CodeType = 'master' | 'unique'

type ShipmentScanOutcome =
  | 'shipped'
  | 'already_shipped'
  | 'not_found'
  | 'invalid_status'
  | 'invalid_format'
  | 'wrong_warehouse'
  | 'session_closed'
  | 'duplicate'
  | 'error'

type ScannedQuantities = {
  total_units: number
  total_cases: number
  per_variant: Record<string, { units: number; cases: number }>
}

type DiscrepancyDetails = {
  inventory_shortfalls?: Array<{
    code: string
    variant_id: string
    expected_units: number
    removed_units: number
    shortfall: number
  }>
  warnings?: string[]
}

type ExpectedSummary = {
  master_cases_available?: number
  units_available?: number
  generated_at?: string
  [key: string]: unknown
}

type ShipmentScanResult = {
  code: string
  normalized_code: string
  code_type: CodeType
  outcome: ShipmentScanOutcome
  message: string
  warnings?: string[]
  discrepancies?: Array<{
    variant_id: string
    expected_units: number
    removed_units: number
    shortfall: number
  }>
  master_case?: {
    id: string
    master_code: string
    case_number: number | null
    status: string
    shipped_at?: string
  }
  session_update?: {
    master_codes_scanned?: string[]
    unique_codes_scanned?: string[]
    scanned_quantities?: ScannedQuantities
    discrepancy_details?: DiscrepancyDetails
    validation_status?: string
  }
}

type StartShipmentResponse = {
  success: boolean
  shipment_session_id: string
  expected_summary?: ExpectedSummary
  scanned_summary?: ScannedQuantities
  master_codes_scanned?: string[]
  unique_codes_scanned?: string[]
}

type CompleteShipmentResponse = {
  success: boolean
  shipment_session_id: string
  validation_status: string
  approved: boolean
  has_discrepancy: boolean
  scanned_summary: ScannedQuantities
  expected_summary?: ExpectedSummary
  discrepancy_details?: DiscrepancyDetails
  message: string
}

type SessionInfo = {
  id: string
  expectedSummary?: ExpectedSummary
  scannedSummary: ScannedQuantities
  discrepancyDetails?: DiscrepancyDetails
  masterCodes: string[]
  uniqueCodes: string[]
  validationStatus: string
}

type ScanLogEntry = {
  id: string
  timestamp: string
  result: ShipmentScanResult
}

type Organization = {
  id: string
  org_name: string
}

type ScannedCodeDetail = {
  code: string
  codeType: 'master' | 'unique'
  productName: string | null
  variantName: string | null
  variantId: string | null
  quantity: number
  scannedAt: string
}

type ShipmentHistoryEntry = {
  sessionId: string
  orderId: string | null
  orderNo: string
  distributorOrgId: string | null
  distributorName: string | null
  scannedSummary: {
    totalCases: number
    totalUnits: number
  }
  expectedSummary: {
    totalCases: number | null
    totalUnits: number | null
  }
  status: string
  hasDiscrepancy: boolean
  warnings: string[]
  createdAt: string | null
  updatedAt: string | null
}

type ShipmentHistoryPageInfo = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasMore: boolean
}

const HISTORY_PAGE_SIZE = 10
const HISTORY_STATUS_BADGES: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  shipped: { label: 'Shipped', variant: 'default' },
  matched: { label: 'Matched', variant: 'secondary' },
  approved: { label: 'Approved', variant: 'default' },
  discrepancy: { label: 'Discrepancy', variant: 'destructive' },
  pending: { label: 'Pending', variant: 'outline' }
}

const HISTORY_RANGE_OPTIONS: Array<{ value: '30d' | '90d' | '180d' | 'all'; label: string }> = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '180d', label: 'Last 180 days' },
  { value: 'all', label: 'All time' }
]

const createEmptyScannedQuantities = (): ScannedQuantities => ({
  total_units: 0,
  total_cases: 0,
  per_variant: {}
})

const formatNumber = (value?: number | null) =>
  typeof value === 'number' && !Number.isNaN(value) ? value.toLocaleString() : '0'

const formatTimestamp = (value?: string) =>
  value ? new Date(value).toLocaleString() : '—'

const outcomeBadgeVariant = (outcome: ShipmentScanOutcome): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (outcome) {
    case 'shipped':
      return 'default'
    case 'duplicate':
    case 'already_shipped':
      return 'secondary'
    case 'not_found':
    case 'invalid_status':
    case 'invalid_format':
    case 'wrong_warehouse':
      return 'destructive'
    default:
      return 'outline'
  }
}

const validationBadgeVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status) {
    case 'approved':
      return 'default'
    case 'matched':
      return 'secondary'
    case 'discrepancy':
      return 'destructive'
    default:
      return 'outline'
  }
}

export default function WarehouseShipView({ userProfile, onViewChange }: WarehouseShipViewProps) {
  void onViewChange

  const supabase = createClient()
  const { toast } = useToast()

  const [distributors, setDistributors] = useState<Organization[]>([])
  const [selectedDistributor, setSelectedDistributor] = useState('')
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([])
  const [qrInput, setQrInput] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [approveDiscrepancy, setApproveDiscrepancy] = useState(false)
  
  // Batch processing states
  const [showBatchInput, setShowBatchInput] = useState(false)
  const [batchInput, setBatchInput] = useState('')
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [batchPreview, setBatchPreview] = useState<Array<{ 
    code: string; 
    type: CodeType;
  }>>([])
  const [showPreview, setShowPreview] = useState(false)

  const [shipmentHistory, setShipmentHistory] = useState<ShipmentHistoryEntry[]>([])
  const [historyPageInfo, setHistoryPageInfo] = useState<ShipmentHistoryPageInfo>({
    page: 1,
    pageSize: HISTORY_PAGE_SIZE,
    total: 0,
    totalPages: 1,
    hasMore: false
  })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [historySearchInput, setHistorySearchInput] = useState('')
  const [historySearchTerm, setHistorySearchTerm] = useState('')
  const [historyRange, setHistoryRange] = useState<'30d' | '90d' | '180d' | 'all'>('90d')

  // Batch processing progress states
  const [batchProgress, setBatchProgress] = useState({
    currentIndex: 0,
    successCount: 0,
    duplicateCount: 0,
    errorCount: 0,
    currentCode: ''
  })
  const [showBatchModal, setShowBatchModal] = useState(false)

  // Scanned codes list
  const [scannedCodes, setScannedCodes] = useState<ScannedCodeDetail[]>([])
  const [loadingScannedCodes, setLoadingScannedCodes] = useState(false)

  useEffect(() => {
    const loadDistributors = async () => {
      try {
        // Get warehouse organization to find its HQ parent
        const { data: warehouseData, error: warehouseError } = await supabase
          .from('organizations')
          .select('id, parent_org_id, org_name')
          .eq('id', userProfile.organization_id)
          .single()

        if (warehouseError) throw warehouseError

        // If warehouse has no parent or warehouse is not WH type, return empty
        if (!warehouseData?.parent_org_id) {
          console.warn('⚠️ Warehouse has no parent HQ')
          setDistributors([])
          return
        }

        const hqId = warehouseData.parent_org_id

        // Find all active distributors under the same HQ
        const { data, error } = await supabase
          .from('organizations')
          .select('id, org_name')
          .eq('org_type_code', 'DIST')
          .eq('parent_org_id', hqId)
          .eq('is_active', true)
          .order('org_name')

        if (error) {
          throw error
        }

        console.log('✅ Loaded distributors under same HQ:', data?.length || 0)
        setDistributors(data || [])
      } catch (error: any) {
        console.error('⚠️ Failed to load distributors for shipping:', error)
        toast({
          title: 'Unable to load distributors',
          description: error?.message || 'Please try again later.',
          variant: 'destructive'
        })
      }
    }

    loadDistributors()
  }, [supabase, toast, userProfile.organization_id])

  const loadScannedCodes = useCallback(
    async (sessionId: string) => {
      setLoadingScannedCodes(true)
      try {
        const response = await fetch(`/api/warehouse/scanned-codes?session_id=${sessionId}`, {
          cache: 'no-store'
        })
        const payload = await response.json()

        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load scanned codes')
        }

        const codes: ScannedCodeDetail[] = Array.isArray(payload?.scanned_codes) ? payload.scanned_codes : []
        setScannedCodes(codes)
      } catch (error: any) {
        console.error('❌ Failed to load scanned codes:', error)
        toast({
          title: 'Unable to load scanned codes',
          description: error?.message || 'Please try again',
          variant: 'destructive'
        })
      } finally {
        setLoadingScannedCodes(false)
      }
    },
    [toast]
  )

  const loadShipmentHistory = useCallback(
    async (pageParam: number) => {
      if (!userProfile.organization_id) return

      const targetPage = Math.max(pageParam, 1)

      setHistoryLoading(true)
      setHistoryError(null)

      try {
        const params = new URLSearchParams({
          warehouse_org_id: userProfile.organization_id,
          page: String(targetPage),
          pageSize: String(HISTORY_PAGE_SIZE),
          range: historyRange,
          statuses: 'matched,approved,discrepancy',
          include_pending: 'false'
        })

        if (historySearchTerm) {
          params.set('search', historySearchTerm)
        }

        const response = await fetch(`/api/warehouse/shipping-history?${params.toString()}`, {
          cache: 'no-store'
        })
        const payload = await response.json()

        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to load shipment history')
        }

        const entries: ShipmentHistoryEntry[] = Array.isArray(payload?.data) ? payload.data : []
        setShipmentHistory(entries)

        const nextPageInfo: ShipmentHistoryPageInfo = payload?.pageInfo
          ? {
              page: payload.pageInfo.page ?? targetPage,
              pageSize: payload.pageInfo.pageSize ?? HISTORY_PAGE_SIZE,
              total: payload.pageInfo.total ?? entries.length,
              totalPages: payload.pageInfo.totalPages ?? 1,
              hasMore: Boolean(payload.pageInfo.hasMore)
            }
          : {
              page: targetPage,
              pageSize: HISTORY_PAGE_SIZE,
              total: entries.length,
              totalPages: 1,
              hasMore: false
            }

        setHistoryPageInfo(nextPageInfo)

        if (nextPageInfo.page !== historyPage) {
          setHistoryPage(nextPageInfo.page)
        }
      } catch (error: any) {
        console.error('❌ Failed to load shipment history:', error)
        setHistoryError(error?.message || 'Failed to load shipment history')
        setShipmentHistory([])
      } finally {
        setHistoryLoading(false)
      }
    },
    [historyPage, historyRange, historySearchTerm, userProfile.organization_id]
  )

  useEffect(() => {
    void loadShipmentHistory(historyPage)
  }, [historyPage, loadShipmentHistory])

  const handleHistorySearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = historySearchInput.trim()
    setHistorySearchTerm(trimmed)
    setHistoryPage(1)
  }

  const handleHistoryRangeChange = (value: '30d' | '90d' | '180d' | 'all') => {
    setHistoryRange(value)
    setHistoryPage(1)
  }

  const handleHistorySearchClear = () => {
    setHistorySearchInput('')
    setHistorySearchTerm('')
    setHistoryPage(1)
  }

  const handleHistoryRefresh = () => {
    void loadShipmentHistory(historyPage)
  }

  const handleHistoryPageChange = (direction: 'previous' | 'next') => {
    const { page, totalPages } = historyPageInfo
    if (direction === 'previous' && page > 1) {
      const target = page - 1
      setHistoryPage(target)
    }
    if (direction === 'next' && page < totalPages) {
      const target = page + 1
      setHistoryPage(target)
    }
  }

  const resetSession = () => {
    setSessionInfo(null)
    setScanLog([])
    setQrInput('')
    setApproveDiscrepancy(false)
  }

  const updateSessionFromScan = (result: ShipmentScanResult) => {
    if (!sessionInfo || !result.session_update) return

    setSessionInfo(prev => {
      if (!prev) return prev

      const next: SessionInfo = {
        ...prev,
        masterCodes: result.session_update?.master_codes_scanned || prev.masterCodes,
        uniqueCodes: result.session_update?.unique_codes_scanned || prev.uniqueCodes,
        scannedSummary: result.session_update?.scanned_quantities || prev.scannedSummary,
        discrepancyDetails: result.session_update?.discrepancy_details || prev.discrepancyDetails,
        validationStatus: result.session_update?.validation_status || prev.validationStatus
      }

      if (!result.session_update?.discrepancy_details) {
        next.discrepancyDetails = prev.discrepancyDetails
      }

      return next
    })
  }

  const handleStartShipment = async () => {
    if (!selectedDistributor) {
      toast({ 
        title: 'Select a distributor', 
        description: 'Please choose a distributor to start the shipment session.', 
        variant: 'destructive' 
      })
      return
    }

    setIsStarting(true)
    try {
      const response = await fetch('/api/warehouse/start-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouse_org_id: userProfile.organization_id,
          distributor_org_id: selectedDistributor,
          user_id: userProfile.id
        })
      })

      const data = (await response.json()) as StartShipmentResponse & { message?: string }

      if (!response.ok) {
        toast({
          title: 'Unable to start session',
          description: data?.message || 'Failed to create shipment session. Please try again.',
          variant: 'destructive'
        })
        return
      }

      const newSessionId = data.shipment_session_id
      
      setSessionInfo({
        id: newSessionId,
        expectedSummary: data.expected_summary,
        scannedSummary: data.scanned_summary || createEmptyScannedQuantities(),
        discrepancyDetails: undefined,
        masterCodes: data.master_codes_scanned || [],
        uniqueCodes: data.unique_codes_scanned || [],
        validationStatus: 'pending'
      })
      setScanLog([])
      setScannedCodes([])
      setApproveDiscrepancy(false)

      toast({
        title: '✓ Session started',
        description: 'You can now begin scanning master cases or individual products.'
      })
      
      void loadScannedCodes(newSessionId)
    } catch (error: any) {
      console.error('❌ Failed to start shipment session:', error)
      toast({
        title: 'Connection error',
        description: 'Unable to connect to the server. Please check your connection and try again.',
        variant: 'destructive'
      })
    } finally {
      setIsStarting(false)
    }
  }

  const handleScan = async () => {
    if (!sessionInfo) {
      toast({ 
        title: 'No active session', 
        description: 'Please start a shipment session first before scanning.', 
        variant: 'destructive' 
      })
      return
    }

    const trimmed = qrInput.trim()
    if (!trimmed) return

    const codeType: CodeType = trimmed.includes('MASTER') ? 'master' : 'unique'

    setIsScanning(true)
    try {
      const response = await fetch('/api/warehouse/scan-for-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_session_id: sessionInfo.id,
          code: trimmed,
          code_type: codeType,
          user_id: userProfile.id
        })
      })

      const data = (await response.json()) as ShipmentScanResult & { message?: string }

      if (!response.ok) {
        // Provide user-friendly error messages
        const errorTitle = response.status === 404 
          ? 'Code not found'
          : response.status === 400
            ? 'Invalid code'
            : response.status === 403
              ? 'Wrong warehouse'
              : 'Scan failed'
        
        toast({
          title: errorTitle,
          description: data?.message || 'Unable to process this QR code. Please try again.',
          variant: 'destructive'
        })
        
        setQrInput('')
        return
      }

      const entry: ScanLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        result: data
      }

      setScanLog(prev => [entry, ...prev])
      updateSessionFromScan(data)

      setQrInput('')

      // Provide clear success/warning feedback
      const toastVariant = data.outcome === 'shipped' 
        ? 'default' 
        : data.outcome === 'duplicate' || data.outcome === 'already_shipped'
          ? 'default' 
          : 'destructive'
      
      const toastTitle = data.outcome === 'shipped'
        ? '✓ Shipment recorded'
        : data.outcome === 'duplicate'
          ? 'Already scanned'
          : data.outcome === 'already_shipped'
            ? 'Already shipped'
            : 'Cannot ship this code'

      toast({
        title: toastTitle,
        description: data.message,
        variant: toastVariant
      })

      if (data.outcome === 'shipped' && sessionInfo) {
        setHistoryPage(1)
        void loadShipmentHistory(1)
        void loadScannedCodes(sessionInfo.id)
      }
    } catch (error: any) {
      console.error('❌ Failed to scan code for shipment:', error)
      toast({
        title: 'Connection error',
        description: 'Unable to connect to the server. Please check your connection and try again.',
        variant: 'destructive'
      })
    } finally {
      setIsScanning(false)
    }
  }

  const handleCompleteShipment = async () => {
    if (!sessionInfo) {
      toast({ 
        title: 'No active session', 
        description: 'Please start a shipment session before completing.', 
        variant: 'destructive' 
      })
      return
    }

    setIsCompleting(true)
    try {
      const response = await fetch('/api/warehouse/complete-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipment_session_id: sessionInfo.id,
          approve_discrepancy: approveDiscrepancy,
          user_id: userProfile.id
        })
      })

      const data = (await response.json()) as CompleteShipmentResponse & { message?: string }

      if (!response.ok) {
        toast({
          title: 'Unable to complete shipment',
          description: data?.message || 'Failed to finalize the shipment. Please try again.',
          variant: 'destructive'
        })
        return
      }

      toast({ 
        title: '✓ Shipment updated', 
        description: data.message 
      })

      void loadShipmentHistory(1)

      const shouldReset = data.validation_status === 'approved' || (data.validation_status === 'matched' && !data.has_discrepancy)

      if (shouldReset) {
        resetSession()
        setSelectedDistributor('')
        return
      }

      setSessionInfo(prev => {
        if (!prev) return prev
        return {
          ...prev,
          validationStatus: data.validation_status,
          scannedSummary: data.scanned_summary || prev.scannedSummary,
          expectedSummary: data.expected_summary || prev.expectedSummary,
          discrepancyDetails: data.discrepancy_details || prev.discrepancyDetails
        }
      })

      if (data.validation_status === 'discrepancy') {
        setApproveDiscrepancy(false)
      }
    } catch (error: any) {
      console.error('❌ Failed to complete shipment session:', error)
      toast({
        title: 'Connection error',
        description: 'Unable to connect to the server. Please check your connection and try again.',
        variant: 'destructive'
      })
    } finally {
      setIsCompleting(false)
    }
  }

  const parseBatchInput = (input: string): Array<{ code: string; type: CodeType }> => {
    if (!input.trim()) return []
    
    const lines = input.split(/\r?\n/).filter(line => line.trim())
    const codes: Array<{ code: string; type: CodeType }> = []
    
    for (const line of lines) {
      const trimmed = line.trim()
      // Skip empty lines or headers
      if (!trimmed || trimmed.toLowerCase().includes('master') && trimmed.toLowerCase().includes('code')) {
        continue
      }
      
      // Detect code type
      const type: CodeType = trimmed.includes('MASTER') || trimmed.includes('-CASE-') ? 'master' : 'unique'
      codes.push({ code: trimmed, type })
    }
    
    return codes
  }

  const handleBatchPreview = () => {
    const preview = parseBatchInput(batchInput)
    setBatchPreview(preview)
    setShowPreview(true)
  }

  const handleBatchProcess = async () => {
    if (!sessionInfo) {
      toast({ title: 'Start a session first', description: 'Create a shipment session before batch processing.', variant: 'destructive' })
      return
    }

    if (batchPreview.length === 0) {
      toast({ title: 'No codes to process', description: 'Please paste QR codes and preview first.', variant: 'destructive' })
      return
    }

    setBatchProcessing(true)
    setBatchProgress({
      currentIndex: 0,
      successCount: 0,
      duplicateCount: 0,
      errorCount: 0,
      currentCode: ''
    })
    setShowBatchModal(true)

    let successCount = 0
    let duplicateCount = 0
    let errorCount = 0
    const failureDetails: string[] = []
    const newLogs: ScanLogEntry[] = []

    try {
      for (let i = 0; i < batchPreview.length; i++) {
        const { code, type } = batchPreview[i]
        
        setBatchProgress(prev => ({
          ...prev,
          currentIndex: i + 1,
          currentCode: code
        }))

        try {
          const response = await fetch('/api/warehouse/scan-for-shipment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shipment_session_id: sessionInfo.id,
              code: code,
              code_type: type,
              user_id: userProfile.id
            })
          })

          const data = (await response.json()) as ShipmentScanResult & { message?: string }

          const entry: ScanLogEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            result: data
          }
          newLogs.push(entry)

          if (response.ok && data.outcome === 'shipped') {
            successCount++
            setBatchProgress(prev => ({ ...prev, successCount: prev.successCount + 1 }))
            updateSessionFromScan(data)
          } else if (data.outcome === 'duplicate' || data.outcome === 'already_shipped') {
            duplicateCount++
            setBatchProgress(prev => ({ ...prev, duplicateCount: prev.duplicateCount + 1 }))
            const detail = data?.message || `Duplicate: ${data?.normalized_code || code}`
            failureDetails.push(detail)
          } else {
            errorCount++
            setBatchProgress(prev => ({ ...prev, errorCount: prev.errorCount + 1 }))
            const detail = data?.message || `Unable to process ${data?.normalized_code || code}`
            failureDetails.push(detail)
          }
          
          // Small delay to prevent overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 100))
        } catch (error) {
          errorCount++
          setBatchProgress(prev => ({ ...prev, errorCount: prev.errorCount + 1 }))
          const detail = error instanceof Error ? error.message : 'Unexpected error occurred during batch processing.'
          failureDetails.push(detail)
        }
      }

      setScanLog(prev => [...newLogs, ...prev])
      
      // Wait a moment to show final counts
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      const summaryMessage = errorCount === 0 && duplicateCount === 0
        ? `Processed ${successCount} codes successfully.`
        : [`Processed ${successCount} codes successfully${duplicateCount > 0 ? `, ${duplicateCount} duplicates` : ''}${errorCount > 0 ? `, ${errorCount} errors` : ''}.`, failureDetails.length ? `
${failureDetails.slice(0, 3).map(detail => `• ${detail}`).join('\n')}${failureDetails.length > 3 ? '\n• View scan history for more details.' : ''}` : '', !failureDetails.length && errorCount > 0 ? 'Check scan history for details.' : '']
            .filter(Boolean)
            .join(' ')

      toast({
        title: 'Batch processing complete',
        description: summaryMessage,
        variant: errorCount === 0 ? 'default' : 'default'
      })

      if (successCount > 0) {
        setHistoryPage(1)
        void loadShipmentHistory(1)
        if (sessionInfo) {
          void loadScannedCodes(sessionInfo.id)
        }
      }

      // Clear batch input
      setBatchInput('')
      setBatchPreview([])
      setShowPreview(false)
      setShowBatchInput(false)
    } catch (error: any) {
      console.error('❌ Batch processing error:', error)
      toast({
        title: 'Batch processing failed',
        description: error?.message || 'Unexpected error occurred.',
        variant: 'destructive'
      })
    } finally {
      setShowBatchModal(false)
      setBatchProcessing(false)
    }
  }

  const removeFromPreview = (index: number) => {
    setBatchPreview(prev => prev.filter((_, i) => i !== index))
  }

  const variantRows = useMemo(() => {
    if (!sessionInfo?.scannedSummary?.per_variant) return []
    return Object.entries(sessionInfo.scannedSummary.per_variant)
  }, [sessionInfo])

  const activeWarnings = sessionInfo?.discrepancyDetails?.warnings || []
  const shortfalls = sessionInfo?.discrepancyDetails?.inventory_shortfalls || []

  const hasDiscrepancy = Boolean(activeWarnings.length || shortfalls.length)

  const historyStartIndex = historyPageInfo.total === 0 ? 0 : (historyPageInfo.page - 1) * historyPageInfo.pageSize + 1
  const historyEndIndex = historyStartIndex === 0 ? 0 : historyStartIndex + shipmentHistory.length - 1

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-gray-900">Warehouse Shipping</h1>
        <p className="text-gray-600">Create shipping sessions, scan master cases, and validate outbound inventory in real time.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Truck className="h-5 w-5" /> Start a shipment session
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Select a distributor to begin tracking what leaves the warehouse.
            </p>
          </div>
          {sessionInfo && (
            <Badge variant={validationBadgeVariant(sessionInfo.validationStatus)}>
              Status: {sessionInfo.validationStatus}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3">
            <Label htmlFor="distributor-select">Distributor</Label>
            <select
              id="distributor-select"
              value={selectedDistributor}
              onChange={event => setSelectedDistributor(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={Boolean(sessionInfo)}
            >
              <option value="">Choose distributor...</option>
              {distributors.map(distributor => (
                <option key={distributor.id} value={distributor.id}>
                  {distributor.org_name}
                </option>
              ))}
            </select>
          </div>

          {!sessionInfo ? (
            <Button onClick={handleStartShipment} className="w-full" disabled={isStarting || !selectedDistributor}>
              {isStarting ? 'Starting session…' : 'Start shipment session'}
            </Button>
          ) : (
            <div className="space-y-6">
              {/* Single Scan Mode */}
              <div className="space-y-2">
                <Label htmlFor="scan-input">Scan QR codes</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="scan-input"
                    value={qrInput}
                    autoFocus
                    placeholder="Scan or paste a master/unique code"
                    onChange={event => setQrInput(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleScan()
                      }
                    }}
                    disabled={isScanning || showBatchInput}
                  />
                  <Button onClick={handleScan} disabled={isScanning || !qrInput.trim() || showBatchInput} className="sm:w-40">
                    {isScanning ? 'Processing…' : (
                      <span className="flex items-center gap-2">
                        <Scan className="h-4 w-4" /> Scan
                      </span>
                    )}
                  </Button>
                </div>
              </div>

              {/* Batch Paste Toggle */}
              <div>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowBatchInput(!showBatchInput)
                    if (showBatchInput) {
                      setBatchInput('')
                      setBatchPreview([])
                      setShowPreview(false)
                    }
                  }}
                  className="w-full"
                  disabled={isScanning || batchProcessing}
                >
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  {showBatchInput ? 'Hide' : 'Show'} Batch Paste
                </Button>
              </div>

              {/* Batch Input Section */}
              {showBatchInput && (
                <div className="border border-blue-200 rounded-lg p-4 bg-blue-50 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="batch-input" className="text-sm font-medium">
                      Paste multiple QR codes (one per line)
                    </Label>
                    <Textarea
                      id="batch-input"
                      value={batchInput}
                      onChange={e => setBatchInput(e.target.value)}
                      placeholder={`MASTER-ORD-HM-1025-07-CASE-001\nPROD-ZEREL2005-MAN-161449-ORD-HM-1025-07-00001\nPROD-ZEREL2005-MAN-161449-ORD-HM-1025-07-00002\n...`}
                      className="min-h-[120px] bg-white"
                      disabled={batchProcessing}
                    />
                    <p className="text-xs text-gray-600">
                      Tip: Copy codes directly from Excel — one code per line, headers will be ignored.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={handleBatchPreview}
                      variant="outline"
                      disabled={!batchInput.trim() || batchProcessing}
                      className="flex-1"
                    >
                      <ListChecks className="h-4 w-4 mr-2" />
                      Preview ({parseBatchInput(batchInput).length} codes)
                    </Button>
                    {showPreview && batchPreview.length > 0 && (
                      <Button
                        onClick={handleBatchProcess}
                        disabled={batchProcessing}
                        className="flex-1"
                      >
                        {batchProcessing ? 'Processing...' : `Process ${batchPreview.length} codes`}
                      </Button>
                    )}
                  </div>

                  {/* Preview Section */}
                  {showPreview && batchPreview.length > 0 && (
                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-gray-900">
                          Preview ({batchPreview.length} codes)
                        </h4>
                        <Badge variant="outline" className="text-xs bg-white">
                          {batchPreview.filter(c => c.type === 'master').length} Master | {batchPreview.filter(c => c.type === 'unique').length} Unique
                        </Badge>
                      </div>

                      {/* Code List */}
                      <div className="space-y-1 max-h-60 overflow-y-auto">
                        {batchPreview.map((item, index) => (
                          <div key={index} className="flex items-center justify-between gap-2 p-2 bg-white rounded text-xs hover:bg-gray-50 border border-gray-200">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <Badge variant={item.type === 'master' ? 'default' : 'secondary'} className="text-[10px] shrink-0 h-5">
                                {item.type === 'master' ? 'Master' : 'Unique'}
                              </Badge>
                              <span className="font-mono text-[10px] truncate flex-1 text-gray-600">{item.code}</span>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeFromPreview(index)}
                              className="h-6 w-6 p-0 hover:bg-red-50 hover:text-red-600"
                              disabled={batchProcessing}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Master cases scanned</p>
                  <p className="mt-2 text-2xl font-semibold">{formatNumber(sessionInfo.masterCodes.length)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Unique codes scanned</p>
                  <p className="mt-2 text-2xl font-semibold">{formatNumber(sessionInfo.uniqueCodes.length)}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Units removed</p>
                  <p className="mt-2 text-2xl font-semibold">{formatNumber(sessionInfo.scannedSummary.total_units)}</p>
                </div>
              </div>

              {(sessionInfo.masterCodes.length > 0 || sessionInfo.uniqueCodes.length > 0) && (
                <div className="rounded-lg border bg-background p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Scanned Codes ({scannedCodes.length})</h3>
                    {loadingScannedCodes && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Review scanned items before completing shipment</p>
                  
                  {loadingScannedCodes ? (
                    <div className="space-y-2">
                      {Array.from({ length: 3 }).map((_, idx) => (
                        <div key={idx} className="h-16 w-full animate-pulse rounded-md bg-muted/30" />
                      ))}
                    </div>
                  ) : scannedCodes.length === 0 ? (
                    <div className="rounded-md border border-dashed bg-muted/20 p-4 text-center text-sm text-muted-foreground">
                      No scanned codes to display
                    </div>
                  ) : (
                    <div className="max-h-80 space-y-2 overflow-y-auto">
                      {scannedCodes.map((item, index) => (
                        <div
                          key={`${item.code}-${index}`}
                          className="flex items-start justify-between gap-3 rounded-md border bg-white p-3 hover:bg-muted/30"
                        >
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <Badge variant={item.codeType === 'master' ? 'default' : 'secondary'} className="text-xs">
                                {item.codeType === 'master' ? 'Master' : 'Unique'}
                              </Badge>
                              <p className="font-semibold text-sm">{item.productName || 'Unknown Product'}</p>
                            </div>
                            <p className="text-xs text-muted-foreground">{item.variantName || 'N/A'}</p>
                            <p className="text-xs font-mono text-muted-foreground break-all">{item.code}</p>
                            <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3 rounded-lg border bg-background p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">Review & complete session</p>
                  </div>
                  <Button
                    onClick={handleCompleteShipment}
                    disabled={isCompleting}
                    className="sm:w-auto"
                  >
                    {isCompleting ? 'Completing…' : 'Complete shipment'}
                  </Button>
                </div>

                {hasDiscrepancy ? (
                  <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                    <div className="flex items-start gap-2 text-amber-700">
                      <AlertTriangle className="mt-0.5 h-4 w-4" />
                      <div>
                        <p className="font-medium">Discrepancies detected</p>
                        <p className="text-amber-800">
                          Resolve warnings or approve the discrepancy to finalize the shipment.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-md border border-amber-200 bg-white p-3">
                      <div>
                        <p className="text-sm font-medium">Approve discrepancy</p>
                        <p className="text-xs text-muted-foreground">Acknowledges shortages and closes the session.</p>
                      </div>
                      <Switch checked={approveDiscrepancy} onCheckedChange={setApproveDiscrepancy} />
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No discrepancies recorded. You can complete the shipment at any time.
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {sessionInfo?.expectedSummary && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="h-5 w-5" /> Session overview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Cases available</p>
                <p className="mt-2 text-2xl font-semibold">{formatNumber(sessionInfo.expectedSummary?.master_cases_available as number)}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Units available</p>
                <p className="mt-2 text-2xl font-semibold">{formatNumber(sessionInfo.expectedSummary?.units_available as number)}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Generated</p>
                <p className="mt-2 text-base font-medium">{formatTimestamp(sessionInfo.expectedSummary?.generated_at as string)}</p>
              </div>
            </div>

            {variantRows.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Per-variant removals</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/2">Variant ID</TableHead>
                      <TableHead className="w-1/4">Units removed</TableHead>
                      <TableHead className="w-1/4">Cases removed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variantRows.map(([variantId, values]) => (
                      <TableRow key={variantId}>
                        <TableCell className="font-mono text-xs sm:text-sm">{variantId}</TableCell>
                        <TableCell>{formatNumber(values.units)}</TableCell>
                        <TableCell>{formatNumber(values.cases)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {hasDiscrepancy && (
              <div className="space-y-3">
                {activeWarnings.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="mb-2 font-semibold">Warnings</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {activeWarnings.map((warning, index) => (
                        <li key={`${warning}-${index}`}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {shortfalls.length > 0 && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <p className="mb-2 font-semibold">Inventory shortfalls</p>
                    <ul className="space-y-1">
                      {shortfalls.map(shortfall => (
                        <li key={`${shortfall.code}-${shortfall.variant_id}`}>
                          <span className="font-mono text-xs sm:text-sm">{shortfall.variant_id}</span> – expected {formatNumber(shortfall.expected_units)} units, removed {formatNumber(shortfall.removed_units)} ({formatNumber(shortfall.shortfall)} short)
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <History className="h-5 w-5" /> Shipment history
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Review completed shipments by order number and distributor.
            </p>
          </div>
          <Badge variant="outline" className="self-start sm:self-auto">
            {historyPageInfo.total} session{historyPageInfo.total === 1 ? '' : 's'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <form onSubmit={handleHistorySearchSubmit} className="flex w-full flex-col gap-2 lg:max-w-xl">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label htmlFor="history-search" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Search by order number
                  </Label>
                  <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="history-search"
                      value={historySearchInput}
                      placeholder="ORD-HM-1025-03"
                      onChange={event => setHistorySearchInput(event.target.value)}
                    />
                    <Button type="submit" disabled={historyLoading || (!historySearchInput.trim() && !historySearchTerm)} className="sm:w-28">
                      Search
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="sm:w-24"
                      onClick={handleHistorySearchClear}
                      disabled={historyLoading || (!historySearchInput && !historySearchTerm)}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              </div>
            </form>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex items-center gap-2">
                <Label htmlFor="history-range" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Range
                </Label>
                <select
                  id="history-range"
                  value={historyRange}
                  onChange={event => handleHistoryRangeChange(event.target.value as '30d' | '90d' | '180d' | 'all')}
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={historyLoading}
                >
                  {HISTORY_RANGE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="button" variant="outline" onClick={handleHistoryRefresh} disabled={historyLoading} className="sm:w-32">
                {historyLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Refreshing
                  </span>
                ) : (
                  'Refresh'
                )}
              </Button>
            </div>
          </div>

          {historyError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p className="font-semibold">Unable to load shipment history</p>
              <p className="mt-1">{historyError}</p>
            </div>
          )}

          {historyLoading && shipmentHistory.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={`history-skeleton-${index}`}
                  className="h-16 w-full animate-pulse rounded-md border border-dashed border-muted-foreground/30 bg-muted/20"
                />
              ))}
            </div>
          ) : shipmentHistory.length === 0 ? (
            <div className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              {historySearchTerm || historyRange !== '90d'
                ? 'No shipments matched your filters. Try adjusting the search or date range.'
                : 'No completed shipments recorded yet. Scanned shipments will appear here once completed.'}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[160px]">Order</TableHead>
                      <TableHead className="min-w-[160px]">Distributor</TableHead>
                      <TableHead className="min-w-[120px]">Cases shipped</TableHead>
                      <TableHead className="min-w-[120px]">Units shipped</TableHead>
                      <TableHead className="min-w-[120px]">Status</TableHead>
                      <TableHead className="min-w-[160px]">Last updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shipmentHistory.map(entry => {
                      const statusKey = entry.status.toLowerCase()
                      const badge = HISTORY_STATUS_BADGES[statusKey] || {
                        label: entry.status,
                        variant: 'outline' as const
                      }

                      return (
                        <TableRow key={entry.sessionId} className="align-top">
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium text-sm">{entry.orderNo}</p>
                              <p className="text-xs text-muted-foreground">Session • {entry.sessionId.slice(0, 8)}…</p>
                              {entry.orderId && (
                                <p className="text-xs text-muted-foreground">Order ID • {entry.orderId.slice(0, 8)}…</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="text-sm font-medium">{entry.distributorName || 'Unknown distributor'}</p>
                              {entry.distributorOrgId && (
                                <p className="text-xs text-muted-foreground">{entry.distributorOrgId}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <p className="font-medium">{formatNumber(entry.scannedSummary.totalCases)}</p>
                              <p className="text-xs text-muted-foreground">
                                Expected {entry.expectedSummary.totalCases != null ? formatNumber(entry.expectedSummary.totalCases) : '—'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <p className="font-medium">{formatNumber(entry.scannedSummary.totalUnits)}</p>
                              <p className="text-xs text-muted-foreground">
                                Expected {entry.expectedSummary.totalUnits != null ? formatNumber(entry.expectedSummary.totalUnits) : '—'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <Badge variant={badge.variant}>{badge.label}</Badge>
                              {entry.hasDiscrepancy && (
                                <p className="text-xs text-amber-700">Discrepancy flagged</p>
                              )}
                              {entry.warnings.length > 0 && (
                                <p className="text-xs text-amber-600">{entry.warnings.length} warning{entry.warnings.length === 1 ? '' : 's'}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <p className="font-medium">{formatTimestamp(entry.updatedAt || entry.createdAt || undefined)}</p>
                              {entry.createdAt && (
                                <p className="text-xs text-muted-foreground">Created {formatTimestamp(entry.createdAt)}</p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing {historyStartIndex ? `${historyStartIndex}-${historyEndIndex}` : '0'} of {historyPageInfo.total}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleHistoryPageChange('previous')}
                    disabled={historyLoading || historyPageInfo.page <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleHistoryPageChange('next')}
                    disabled={historyLoading || historyPageInfo.page >= historyPageInfo.totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {scanLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ListChecks className="h-5 w-5" /> Scan history
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {scanLog.map(entry => (
              <div key={entry.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={outcomeBadgeVariant(entry.result.outcome)}>{entry.result.outcome}</Badge>
                    <p className="font-medium">{entry.result.message}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatTimestamp(entry.timestamp)}</p>
                </div>
                <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-mono break-all">{entry.result.normalized_code}</span>
                  <span className="uppercase tracking-wide">{entry.result.code_type}</span>
                </div>
                {entry.result.warnings && entry.result.warnings.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 px-4 text-xs text-amber-700">
                    {entry.result.warnings.map((warning, index) => (
                      <li key={`${entry.id}-warning-${index}`}>{warning}</li>
                    ))}
                  </ul>
                )}
                {entry.result.discrepancies && entry.result.discrepancies.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 px-4 text-xs text-red-700">
                    {entry.result.discrepancies.map((item, index) => (
                      <li key={`${entry.id}-discrepancy-${index}`}>
                        {item.variant_id}: expected {formatNumber(item.expected_units)}, removed {formatNumber(item.removed_units)} ({formatNumber(item.shortfall)} short)
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!sessionInfo && scanLog.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Start a shipment session to begin scanning cases headed to distributors.
          </CardContent>
        </Card>
      )}

      <BatchProcessingModal
        open={showBatchModal}
        total={batchPreview.length}
        successCount={batchProgress.successCount}
        duplicateCount={batchProgress.duplicateCount}
        errorCount={batchProgress.errorCount}
        currentIndex={batchProgress.currentIndex}
        currentCode={batchProgress.currentCode}
      />
    </div>
  )
}
