'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Scan, Truck, ShieldCheck, AlertTriangle, ListChecks, ClipboardPaste, X, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'

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
  const [batchPreview, setBatchPreview] = useState<Array<{ code: string; type: CodeType }>>([])
  const [showPreview, setShowPreview] = useState(false)

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
      toast({ title: 'Select a distributor', description: 'Choose a distributor to begin.', variant: 'destructive' })
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
        throw new Error(data?.message || 'Failed to start shipment session')
      }

      setSessionInfo({
        id: data.shipment_session_id,
        expectedSummary: data.expected_summary,
        scannedSummary: data.scanned_summary || createEmptyScannedQuantities(),
        discrepancyDetails: undefined,
        masterCodes: data.master_codes_scanned || [],
        uniqueCodes: data.unique_codes_scanned || [],
        validationStatus: 'pending'
      })
      setScanLog([])
      setApproveDiscrepancy(false)

      toast({
        title: 'Shipment session started',
        description: 'You can begin scanning master or unique codes.'
      })
    } catch (error: any) {
      console.error('❌ Failed to start shipment session:', error)
      toast({
        title: 'Unable to start session',
        description: error?.message || 'Unexpected error occurred.',
        variant: 'destructive'
      })
    } finally {
      setIsStarting(false)
    }
  }

  const handleScan = async () => {
    if (!sessionInfo) {
      toast({ title: 'Start a session first', description: 'Create a shipment session before scanning.', variant: 'destructive' })
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
        throw new Error(data?.message || 'Failed to process scan')
      }

      const entry: ScanLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        result: data
      }

      setScanLog(prev => [entry, ...prev])
      updateSessionFromScan(data)

      setQrInput('')

      toast({
        title: data.outcome === 'shipped' ? 'Shipment recorded' : 'Scan processed',
        description: data.message,
        variant: data.outcome === 'shipped' ? 'success' : data.outcome === 'duplicate' ? 'default' : 'destructive'
      })
    } catch (error: any) {
      console.error('❌ Failed to scan code for shipment:', error)
      toast({
        title: 'Scan failed',
        description: error?.message || 'Unexpected error occurred.',
        variant: 'destructive'
      })
    } finally {
      setIsScanning(false)
    }
  }

  const handleCompleteShipment = async () => {
    if (!sessionInfo) {
      toast({ title: 'No active session', description: 'Start a shipment session before completing.', variant: 'destructive' })
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
        throw new Error(data?.message || 'Failed to complete shipment session')
      }

      toast({ title: 'Shipment session updated', description: data.message })

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
        title: 'Completion failed',
        description: error?.message || 'Unexpected error occurred.',
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
    let successCount = 0
    let errorCount = 0
    const newLogs: ScanLogEntry[] = []

    try {
      for (let i = 0; i < batchPreview.length; i++) {
        const { code, type } = batchPreview[i]
        
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

          if (response.ok && data.outcome === 'shipped') {
            successCount++
            
            const entry: ScanLogEntry = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              timestamp: new Date().toISOString(),
              result: data
            }
            newLogs.push(entry)
            updateSessionFromScan(data)
          } else {
            errorCount++
          }
          
          // Small delay to prevent overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 100))
        } catch (error) {
          errorCount++
        }
      }

      setScanLog(prev => [...newLogs, ...prev])
      
      toast({
        title: 'Batch processing complete',
        description: `Processed ${successCount} codes successfully, ${errorCount} failed.`,
        variant: errorCount === 0 ? 'success' : 'default'
      })

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
                    <div className="bg-white border border-gray-200 rounded-lg p-3 max-h-[300px] overflow-y-auto">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-gray-900">
                          Preview ({batchPreview.length} codes)
                        </h4>
                        <Badge variant="outline" className="text-xs">
                          {batchPreview.filter(c => c.type === 'master').length} Master | {batchPreview.filter(c => c.type === 'unique').length} Unique
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        {batchPreview.map((item, index) => (
                          <div key={index} className="flex items-center justify-between gap-2 p-2 bg-gray-50 rounded text-xs hover:bg-gray-100">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <Badge variant={item.type === 'master' ? 'default' : 'secondary'} className="text-xs shrink-0">
                                {item.type === 'master' ? 'Master' : 'Unique'}
                              </Badge>
                              <span className="font-mono truncate">{item.code}</span>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => removeFromPreview(index)}
                              className="h-6 w-6 p-0"
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
    </div>
  )
}
