'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import {
  FileText,
  Hash,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Play,
  Clock,
  Info,
  Settings2,
  Database,
  ArrowRight,
  AlertTriangle,
  Sparkles
} from 'lucide-react'

interface DocSequenceTabProps {
  userProfile: {
    id: string
    organizations: {
      id: string
      org_type_code: string
    }
    roles: {
      role_level: number
    }
  }
}

interface DocSequence {
  doc_type: string
  year: number
  next_seq: number
  last_used_at: string | null
  example: string
}

interface MigrationStatus {
  orders_total: number
  orders_migrated: number
  orders_pending: number
  documents_total: number
  documents_migrated: number
  documents_pending: number
  last_job: {
    id: string
    status: 'running' | 'completed' | 'failed'
    started_at: string
    completed_at: string | null
    records_processed: number
    records_failed: number
    error_message: string | null
  } | null
}

// Document type display names
const DOC_TYPE_NAMES: Record<string, { name: string; category: string; description: string; singleDoc?: boolean }> = {
  'ORD': { name: 'Order', category: 'Order Management', description: 'Main order container for H2M, D2H, S2D', singleDoc: true },
  'SO': { name: 'Sales Order', category: 'Sales', description: 'Sales order from distributor to shop', singleDoc: true },
  'QT': { name: 'Quotation', category: 'Sales', description: 'Price quotation before order', singleDoc: true },
  'PO': { name: 'Purchase Order', category: 'Purchasing', description: 'Purchase order to manufacturer (1:1 with order)', singleDoc: true },
  'GR': { name: 'Goods Received', category: 'Warehouse', description: 'Goods received note (1:1 with order)', singleDoc: true },
  'DO': { name: 'Delivery Order', category: 'Warehouse', description: 'Delivery order for shipment (1:1 with order)', singleDoc: true },
  'SI': { name: 'Sales Invoice', category: 'Finance', description: 'Invoice for sales (can have deposit + balance invoices)' },
  'CN': { name: 'Credit Note', category: 'Adjustments', description: 'Credit adjustment' },
  'DN': { name: 'Debit Note', category: 'Adjustments', description: 'Debit adjustment' },
  'PV': { name: 'Payment Voucher', category: 'Finance', description: 'Payment for invoices (deposit + balance payments)' },
  'RC': { name: 'Receipt', category: 'Finance', description: 'Receipt for incoming payments (deposit + balance receipts)' },
  'DI': { name: 'Deposit Invoice', category: 'Finance', description: 'Invoice for deposit payment' },
  'DP': { name: 'Deposit Payment', category: 'Finance', description: 'Deposit payment record' },
  'BR': { name: 'Balance Request', category: 'Finance', description: 'Request for balance payment (can have multiple requests)' },
  'BP': { name: 'Balance Payment', category: 'Finance', description: 'Balance payment record' },
}

// Legacy to new format examples - showing order-referenced numbering
const FORMAT_EXAMPLES: Record<string, { legacy: string; new: string; note?: string }> = {
  'ORD': { legacy: 'ORD-HM-1225-01', new: 'ORD26000017', note: 'Base sequence for all documents' },
  'SO': { legacy: 'ORD-DH-0126-03', new: 'SO26000017', note: 'Same sequence as order' },
  'PO': { legacy: 'PO-ORD-HM-0126-07', new: 'PO26000017', note: 'Same sequence as order' },
  'GR': { legacy: 'GR-ORD-HM-0126-01', new: 'GR26000017', note: 'Same sequence as order' },
  'DO': { legacy: 'DO-ORD-HM-0126-01', new: 'DO26000017', note: 'Same sequence as order' },
  'SI': { legacy: 'INV-ORD-HM-0126-01', new: 'SI26000017-01', note: 'Sub-sequence: -01 deposit, -02 balance' },
  'CN': { legacy: 'CN-ORD-HM-0126-01', new: 'CN26000017-01', note: 'Sub-sequence per credit note' },
  'DN': { legacy: 'DN-ORD-HM-0126-01', new: 'DN26000017-01', note: 'Sub-sequence per debit note' },
  'PV': { legacy: 'PAY-HM-0126-01', new: 'PV26000017-01', note: 'Sub-sequence: -01 deposit, -02+ balance' },
  'RC': { legacy: 'RCPT-HM-0126-01', new: 'RC26000017-01', note: 'Sub-sequence: -01 deposit, -02+ balance' },
  'QT': { legacy: 'QT-HM-0126-01', new: 'QT26000017', note: 'Same sequence as order' },
  'BR': { legacy: 'REQ-HM-0126-07', new: 'BR26000017-01', note: 'Sub-sequence per request' },
}

export default function DocSequenceTab({ userProfile }: DocSequenceTabProps) {
  const [loading, setLoading] = useState(true)
  const [sequences, setSequences] = useState<DocSequence[]>([])
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null)
  const [showMigrationDialog, setShowMigrationDialog] = useState(false)
  const [migrating, setMigrating] = useState(false)
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null)

  const supabase = createClient()
  const canManage = userProfile.roles.role_level <= 10 // Super Admin or HQ Admin only
  const currentYear = new Date().getFullYear()

  const loadData = useCallback(async () => {
    try {
      // Get sequences - using type assertion since migration may not be run yet
      const { data: seqData, error: seqError } = await supabase.rpc('get_doc_sequences' as any, {
        p_company_id: userProfile.organizations.id
      })

      if (seqError) {
        console.error('Error loading sequences:', seqError)
      } else {
        setSequences((seqData as DocSequence[]) || [])
      }

      // Get migration status
      const { data: statusData, error: statusError } = await supabase.rpc('get_doc_migration_status' as any, {
        p_company_id: userProfile.organizations.id
      })

      if (statusError) {
        console.error('Error loading migration status:', statusError)
      } else {
        setMigrationStatus(statusData as MigrationStatus)
      }
    } catch (error) {
      console.error('Error loading doc sequence data:', error)
    } finally {
      setLoading(false)
    }
  }, [supabase, userProfile.organizations.id])

  useEffect(() => {
    loadData()

    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }
    }
  }, [loadData, pollingInterval])

  // Start polling when migration is running
  useEffect(() => {
    if (migrationStatus?.last_job?.status === 'running') {
      const interval = setInterval(() => {
        loadData()
      }, 3000) // Poll every 3 seconds
      setPollingInterval(interval)
    } else if (pollingInterval) {
      clearInterval(pollingInterval)
      setPollingInterval(null)
    }
  }, [migrationStatus?.last_job?.status, loadData, pollingInterval])

  const handleStartMigration = async () => {
    if (!canManage) {
      toast({
        title: 'Permission Denied',
        description: 'Only administrators can run the migration',
        variant: 'destructive'
      })
      return
    }

    setMigrating(true)

    try {
      const { data, error } = await supabase.rpc('backfill_display_doc_numbers' as any, {
        p_company_id: userProfile.organizations.id
      })

      if (error) throw error

      const result = data as { success: boolean; error?: string; records_processed?: number; records_failed?: number }

      if (result?.success) {
        toast({
          title: 'Migration Started',
          description: `Processing ${migrationStatus?.orders_pending || 0} orders and ${migrationStatus?.documents_pending || 0} documents`,
        })
        setShowMigrationDialog(false)
        loadData()
      } else {
        toast({
          title: 'Migration Failed',
          description: result?.error || 'Unknown error occurred',
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      console.error('Migration error:', error)
      toast({
        title: 'Migration Error',
        description: error.message || 'Failed to start migration',
        variant: 'destructive'
      })
    } finally {
      setMigrating(false)
    }
  }

  const totalPending = (migrationStatus?.orders_pending || 0) + (migrationStatus?.documents_pending || 0)
  const totalRecords = (migrationStatus?.orders_total || 0) + (migrationStatus?.documents_total || 0)
  const migrationProgress = totalRecords > 0
    ? Math.round(((totalRecords - totalPending) / totalRecords) * 100)
    : 100

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Info Banner - Order-Referenced Numbering System */}
      <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div className="space-y-3">
              <h4 className="font-semibold text-blue-900">Order-Referenced Document Numbering</h4>
              <p className="text-sm text-blue-700">
                All documents in a workflow now share the same base sequence number from their parent order.
                This makes it easy to trace all related documents at a glance.
              </p>

              {/* Example Visual */}
              <div className="bg-white/70 rounded-lg p-4 border border-blue-200">
                <p className="text-xs font-medium text-blue-800 mb-3">Example: Order ORD26000017 Document Flow</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="flex items-center gap-2 text-xs">
                    <Badge className="bg-blue-500 text-white">Order</Badge>
                    <span className="font-mono text-blue-700">ORD26000017</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="border-blue-300 text-blue-700">PO</Badge>
                    <span className="font-mono text-blue-600">PO26000017</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="border-green-300 text-green-700">Dep. Invoice</Badge>
                    <span className="font-mono text-green-600">SI26000017-01</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="border-green-300 text-green-700">Bal. Invoice</Badge>
                    <span className="font-mono text-green-600">SI26000017-02</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="border-purple-300 text-purple-700">Dep. Payment</Badge>
                    <span className="font-mono text-purple-600">PV26000017-01</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="border-orange-300 text-orange-700">Dep. Receipt</Badge>
                    <span className="font-mono text-orange-600">RC26000017-01</span>
                  </div>
                </div>
              </div>

              {/* Key Points */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="flex items-start gap-2 bg-white/50 p-2 rounded">
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-gray-800">1:1 Documents</span>
                    <p className="text-gray-600">PO, SO, DO, GR share exact order sequence</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 bg-white/50 p-2 rounded">
                  <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-medium text-gray-800">Multiple Documents</span>
                    <p className="text-gray-600">Invoices, Payments, Receipts add sub-sequence (-01, -02)</p>
                  </div>
                </div>
              </div>

              {/* Legacy comparison */}
              <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-blue-200">
                <span className="text-xs text-blue-600 font-medium">Format Upgrade:</span>
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="bg-gray-100">Legacy</Badge>
                  <span className="text-gray-500 line-through">ORD-HM-1225-01</span>
                  <ArrowRight className="w-3 h-3 text-gray-400" />
                  <Badge variant="outline" className="bg-green-100 text-green-700 border-green-300">New</Badge>
                  <span className="font-mono text-green-700 font-medium">ORD26000017</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Migration Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Document Number Migration
              </CardTitle>
              <CardDescription>
                Backfill new display numbers for historical records
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Progress Overview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Migration Progress</span>
              <span className="font-medium">{migrationProgress}%</span>
            </div>
            <Progress value={migrationProgress} className="h-2" />
            <div className="flex justify-between text-xs text-gray-500">
              <span>{totalRecords - totalPending} migrated</span>
              <span>{totalPending} pending</span>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">
                {migrationStatus?.orders_total || 0}
              </div>
              <div className="text-sm text-gray-600">Total Orders</div>
              <div className="text-xs text-gray-500 mt-1">
                {migrationStatus?.orders_migrated || 0} migrated
              </div>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">
                {migrationStatus?.documents_total || 0}
              </div>
              <div className="text-sm text-gray-600">Total Documents</div>
              <div className="text-xs text-gray-500 mt-1">
                {migrationStatus?.documents_migrated || 0} migrated
              </div>
            </div>
            <div className="p-4 bg-yellow-50 rounded-lg">
              <div className="text-2xl font-bold text-yellow-700">
                {migrationStatus?.orders_pending || 0}
              </div>
              <div className="text-sm text-yellow-600">Orders Pending</div>
            </div>
            <div className="p-4 bg-yellow-50 rounded-lg">
              <div className="text-2xl font-bold text-yellow-700">
                {migrationStatus?.documents_pending || 0}
              </div>
              <div className="text-sm text-yellow-600">Docs Pending</div>
            </div>
          </div>

          {/* Last Job Status */}
          {migrationStatus?.last_job && (
            <div className="p-4 border rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {migrationStatus.last_job.status === 'running' && (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                  )}
                  {migrationStatus.last_job.status === 'completed' && (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  )}
                  {migrationStatus.last_job.status === 'failed' && (
                    <AlertCircle className="w-4 h-4 text-red-500" />
                  )}
                  <span className="font-medium">Last Migration Job</span>
                  <Badge variant={
                    migrationStatus.last_job.status === 'running' ? 'default' :
                      migrationStatus.last_job.status === 'completed' ? 'outline' : 'destructive'
                  }>
                    {migrationStatus.last_job.status}
                  </Badge>
                </div>
                <div className="text-sm text-gray-500">
                  {new Date(migrationStatus.last_job.started_at).toLocaleString()}
                </div>
              </div>
              {migrationStatus.last_job.status === 'completed' && (
                <div className="mt-2 text-sm text-gray-600">
                  Processed {migrationStatus.last_job.records_processed} records
                  {migrationStatus.last_job.records_failed > 0 && (
                    <span className="text-red-500">
                      , {migrationStatus.last_job.records_failed} failed
                    </span>
                  )}
                </div>
              )}
              {migrationStatus.last_job.error_message && (
                <div className="mt-2 text-sm text-red-600">
                  Error: {migrationStatus.last_job.error_message}
                </div>
              )}
            </div>
          )}

          {/* Migration Button - Always show for staging/production deployment */}
          {canManage && (
            <div className="space-y-4">
              {totalPending > 0 ? (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-amber-800">Migration Required</p>
                      <p className="text-sm text-amber-700">
                        {totalPending} records need to be migrated to the new document format.
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => setShowMigrationDialog(true)}
                    disabled={migrationStatus?.last_job?.status === 'running'}
                    className="gap-2 bg-amber-600 hover:bg-amber-700"
                  >
                    {migrationStatus?.last_job?.status === 'running' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Migration Running...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        Run Migration Now
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-green-600 bg-green-50 p-4 rounded-lg">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>All documents have been migrated to the new numbering format!</span>
                </div>
              )}

              {/* Re-run migration option for admins */}
              {totalPending === 0 && (
                <div className="p-4 border border-dashed border-gray-300 rounded-lg">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-500 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium text-gray-800">Deployment Guide</p>
                      <p className="text-sm text-gray-600 mt-1">
                        When deploying to staging or production:
                      </p>
                      <ol className="text-sm text-gray-600 mt-2 ml-4 list-decimal space-y-1">
                        <li>Run the SQL migration script to add the new columns and functions</li>
                        <li>Click the button below to migrate existing documents to the new format</li>
                        <li>New documents will automatically receive both legacy and new format numbers</li>
                      </ol>
                      <div className="mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowMigrationDialog(true)}
                          disabled={migrationStatus?.last_job?.status === 'running'}
                          className="gap-2"
                        >
                          <RefreshCw className="w-4 h-4" />
                          Re-run Migration (Safe)
                        </Button>
                        <p className="text-xs text-gray-500 mt-2">
                          This is safe to run multiple times - it only processes records without display numbers.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Current Sequences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash className="w-5 h-5" />
            Document Sequence - {currentYear}
          </CardTitle>
          <CardDescription>
            Current sequence numbers for new documents. Numbers reset at the start of each year.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sequences.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead className="text-right">Next Number</TableHead>
                  <TableHead>Example</TableHead>
                  <TableHead>Last Used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sequences.map((seq) => (
                  <TableRow key={`${seq.doc_type}-${seq.year}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">
                          {DOC_TYPE_NAMES[seq.doc_type]?.name || seq.doc_type}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{seq.doc_type}</Badge>
                    </TableCell>
                    <TableCell>{seq.year}</TableCell>
                    <TableCell className="text-right font-mono">
                      {seq.next_seq.toLocaleString().padStart(6, '0')}
                    </TableCell>
                    <TableCell className="font-mono text-green-600">
                      {seq.example}
                    </TableCell>
                    <TableCell className="text-gray-500 text-sm">
                      {seq.last_used_at
                        ? new Date(seq.last_used_at).toLocaleDateString()
                        : '-'
                      }
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Hash className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No sequences generated yet.</p>
              <p className="text-sm">Sequences will be created automatically when documents are created.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Format Reference */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            Order-Referenced Document Format
          </CardTitle>
          <CardDescription>
            All documents reference their parent order sequence for easy traceability
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Explanation */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <p className="font-medium mb-1">How Order-Referenced Numbering Works</p>
                <ul className="list-disc list-inside space-y-1 text-amber-700">
                  <li><strong>Base Number:</strong> When an order is created, it gets a sequence (e.g., 000017)</li>
                  <li><strong>1:1 Documents:</strong> PO, SO, DO, GR use the same number (PO26000017)</li>
                  <li><strong>Multiple Documents:</strong> Invoices, Payments, Receipts add sub-sequence (SI26000017-01, SI26000017-02)</li>
                </ul>
              </div>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Document Type</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Legacy Format</TableHead>
                <TableHead></TableHead>
                <TableHead>New Format</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(FORMAT_EXAMPLES).map(([docType, formats]) => (
                <TableRow key={docType}>
                  <TableCell>
                    <div>
                      <span className="font-medium">
                        {DOC_TYPE_NAMES[docType]?.name || docType}
                      </span>
                      <p className="text-xs text-gray-500">
                        {DOC_TYPE_NAMES[docType]?.description}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {DOC_TYPE_NAMES[docType]?.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-gray-400 text-sm line-through">
                    {formats.legacy}
                  </TableCell>
                  <TableCell>
                    <ArrowRight className="w-4 h-4 text-gray-400" />
                  </TableCell>
                  <TableCell>
                    <span className={`font-mono font-medium ${DOC_TYPE_NAMES[docType]?.singleDoc
                        ? 'text-blue-600'
                        : 'text-green-600'
                      }`}>
                      {formats.new}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-gray-500">
                      {formats.note}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 pt-4 border-t">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded bg-blue-500"></div>
              <span className="text-gray-600">1:1 with Order (same sequence)</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded bg-green-500"></div>
              <span className="text-gray-600">Multiple per Order (with sub-sequence -01, -02, etc.)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Complete Document Flow Visual */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-500" />
            Complete Document Flow Example
          </CardTitle>
          <CardDescription>
            See how all documents in an order workflow are numbered
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg p-6">
            {/* Order Header */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-md">
                <FileText className="w-5 h-5" />
                <span className="font-semibold">Order</span>
                <Badge className="bg-white text-blue-600 font-mono">ORD26000017</Badge>
              </div>
              <p className="text-xs text-gray-500 mt-2">Base sequence: 000017</p>
            </div>

            {/* Document Flow Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Purchase Order */}
              <div className="bg-white rounded-lg p-4 border-2 border-blue-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Purchase Order</span>
                  <Badge variant="outline" className="text-blue-600 border-blue-300">1:1</Badge>
                </div>
                <div className="font-mono text-lg text-blue-600 font-bold">PO26000017</div>
                <p className="text-xs text-gray-500 mt-1">Same as order sequence</p>
              </div>

              {/* Deposit Invoice */}
              <div className="bg-white rounded-lg p-4 border-2 border-green-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Deposit Invoice</span>
                  <Badge variant="outline" className="text-green-600 border-green-300">30%</Badge>
                </div>
                <div className="font-mono text-lg text-green-600 font-bold">SI26000017-01</div>
                <p className="text-xs text-gray-500 mt-1">First invoice for this order</p>
              </div>

              {/* Deposit Payment */}
              <div className="bg-white rounded-lg p-4 border-2 border-purple-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Deposit Payment</span>
                  <Badge variant="outline" className="text-purple-600 border-purple-300">30%</Badge>
                </div>
                <div className="font-mono text-lg text-purple-600 font-bold">PV26000017-01</div>
                <p className="text-xs text-gray-500 mt-1">First payment for this order</p>
              </div>

              {/* Deposit Receipt */}
              <div className="bg-white rounded-lg p-4 border-2 border-orange-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Deposit Receipt</span>
                  <Badge variant="outline" className="text-orange-600 border-orange-300">30%</Badge>
                </div>
                <div className="font-mono text-lg text-orange-600 font-bold">RC26000017-01</div>
                <p className="text-xs text-gray-500 mt-1">First receipt for this order</p>
              </div>

              {/* Balance Request */}
              <div className="bg-white rounded-lg p-4 border-2 border-amber-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Balance Request</span>
                  <Badge variant="outline" className="text-amber-600 border-amber-300">70%</Badge>
                </div>
                <div className="font-mono text-lg text-amber-600 font-bold">BR26000017-01</div>
                <p className="text-xs text-gray-500 mt-1">First balance request</p>
              </div>

              {/* Balance Payment */}
              <div className="bg-white rounded-lg p-4 border-2 border-purple-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Balance Payment</span>
                  <Badge variant="outline" className="text-purple-600 border-purple-300">70%</Badge>
                </div>
                <div className="font-mono text-lg text-purple-600 font-bold">PV26000017-02</div>
                <p className="text-xs text-gray-500 mt-1">Second payment for this order</p>
              </div>

              {/* Balance Receipt */}
              <div className="bg-white rounded-lg p-4 border-2 border-orange-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Balance Receipt</span>
                  <Badge variant="outline" className="text-orange-600 border-orange-300">70%</Badge>
                </div>
                <div className="font-mono text-lg text-orange-600 font-bold">RC26000017-02</div>
                <p className="text-xs text-gray-500 mt-1">Second receipt for this order</p>
              </div>

              {/* Delivery Order */}
              <div className="bg-white rounded-lg p-4 border-2 border-blue-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Delivery Order</span>
                  <Badge variant="outline" className="text-blue-600 border-blue-300">1:1</Badge>
                </div>
                <div className="font-mono text-lg text-blue-600 font-bold">DO26000017</div>
                <p className="text-xs text-gray-500 mt-1">Same as order sequence</p>
              </div>

              {/* Goods Received */}
              <div className="bg-white rounded-lg p-4 border-2 border-blue-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Goods Received</span>
                  <Badge variant="outline" className="text-blue-600 border-blue-300">1:1</Badge>
                </div>
                <div className="font-mono text-lg text-blue-600 font-bold">GR26000017</div>
                <p className="text-xs text-gray-500 mt-1">Same as order sequence</p>
              </div>
            </div>

            {/* Benefits */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="flex items-center gap-2 bg-white/80 p-3 rounded-lg">
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span className="text-xs text-gray-700"><strong>Easy Tracking:</strong> All docs share 000017</span>
              </div>
              <div className="flex items-center gap-2 bg-white/80 p-3 rounded-lg">
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span className="text-xs text-gray-700"><strong>Clear Sequence:</strong> -01, -02 shows order</span>
              </div>
              <div className="flex items-center gap-2 bg-white/80 p-3 rounded-lg">
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span className="text-xs text-gray-700"><strong>No Confusion:</strong> Yearly reset, unique IDs</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Migration Confirmation Dialog */}
      <Dialog open={showMigrationDialog} onOpenChange={setShowMigrationDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Confirm Migration
            </DialogTitle>
            <DialogDescription>
              This will generate new display document numbers for all existing records.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="bg-gray-50 p-4 rounded-lg space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Orders to migrate:</span>
                <span className="font-medium">{migrationStatus?.orders_pending || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Documents to migrate:</span>
                <span className="font-medium">{migrationStatus?.documents_pending || 0}</span>
              </div>
              <div className="border-t pt-2 mt-2">
                <div className="flex justify-between font-medium">
                  <span>Total records:</span>
                  <span>{totalPending}</span>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-500 mt-0.5" />
                <div className="text-sm text-blue-700">
                  <p className="font-medium">This migration is safe:</p>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li>Legacy document numbers will NOT be changed</li>
                    <li>Only records without display numbers will be processed</li>
                    <li>Can be re-run safely if interrupted</li>
                    <li>Numbers are generated in chronological order</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMigrationDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleStartMigration} disabled={migrating} className="gap-2">
              {migrating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Start Migration
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
