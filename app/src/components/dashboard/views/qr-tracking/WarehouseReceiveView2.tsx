'use client'

import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  CheckCircle, AlertTriangle, Loader2, Rocket, Clock, FileText, RotateCcw, ListChecks, User as UserIcon, CalendarClock,
  Search, Download, ChevronDown, ChevronRight, MoreVertical, Boxes, PackageCheck, PackagePlus, PackageMinus, ScrollText,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string
  organizations: { id: string; org_name: string; org_type_code: string }
  roles: { role_level: number }
}

interface WarehouseReceiveView2Props {
  userProfile: UserProfile
}

interface SummaryItem {
  product_id: string | null
  variant_id: string
  product_name: string
  variant_name: string
  ordered_qty: number
  previously_received: number
  cumulative_received: number
  ordered_balance: number
  extra_received: number
}

interface Summary {
  order: { id: string; order_no: string; display_doc_no: string | null }
  batch: {
    id: string
    batch_code: string
    receiving_status: string
    receiving_mode: string | null
    receiving_worker_id: string | null
    receiving_heartbeat: string | null
    receiving_progress: number | null
    qr_completed: boolean
    is_stale: boolean
    total_master_codes: number
    received_master_codes: number
    total_unique_codes: number
    received_unique_codes: number
    buffer_codes: number
    received_buffer_codes: number
  }
  summary: {
    ordered_qty: number
    expected_buffer: number
    expected_total: number
    inventory_received: number
    remaining_ordered: number
    actual_extra_received: number
    receipt_status: 'not_started' | 'partially_received' | 'fully_received'
  }
  items: SummaryItem[]
  warranty_bonus_percent: number
  receipt_tables_available: boolean
}

function CountUp({ value }: { value: number }) {
  const [count, setCount] = useState(value)
  const countRef = useRef(count)
  useEffect(() => { countRef.current = count }, [count])
  useEffect(() => {
    const start = countRef.current
    const end = value
    if (start === end) return
    const duration = 1200
    const startTime = Date.now()
    const timer = setInterval(() => {
      let progress = (Date.now() - startTime) / duration
      if (progress > 1) progress = 1
      setCount(Math.floor(start + (end - start) * progress))
      if (progress === 1) clearInterval(timer)
    }, 20)
    return () => clearInterval(timer)
  }, [value])
  return <>{count.toLocaleString()}</>
}

const fmtDate = (d: Date) =>
  d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function WarehouseReceiveView2({ userProfile }: WarehouseReceiveView2Props) {
  const [orders, setOrders] = useState<any[]>([])
  const [selectedOrder, setSelectedOrder] = useState<string>('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [receiveNow, setReceiveNow] = useState<Record<string, number>>({})
  const [remarks, setRemarks] = useState('')
  const [processing, setProcessing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [startTime, setStartTime] = useState<number | null>(null)
  const [elapsedTime, setElapsedTime] = useState<string>('0s')
  const [showFullConfirm, setShowFullConfirm] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const [historyOrder, setHistoryOrder] = useState<any>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [showGlobalHistory, setShowGlobalHistory] = useState(false)
  const [globalHistory, setGlobalHistory] = useState<any[]>([])
  const [globalLoading, setGlobalLoading] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  // Only an explicit confirmed receiving action sets this true. The worker is
  // NEVER triggered by page load, order selection or polling — only while a job
  // started in THIS session is in flight.
  const activeJobRef = useRef(false)
  // Stable idempotency key for the in-progress confirm attempt (survives retries,
  // cleared on success) so double-clicks/retries never double-post inventory.
  const pendingKeyRef = useRef<string | null>(null)
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    if (userProfile?.organization_id) fetchOrders()
  }, [userProfile?.organization_id])

  // Elapsed timer while the worker is processing
  useEffect(() => {
    let interval: NodeJS.Timeout | undefined
    if (processing && startTime) {
      interval = setInterval(() => {
        const seconds = Math.floor((Date.now() - startTime) / 1000)
        setElapsedTime(`${Math.floor(seconds / 60)}m ${seconds % 60}s`)
      }, 1000)
    }
    return () => { if (interval) clearInterval(interval) }
  }, [processing, startTime])

  // Observe QR progress while a batch is in flight, and ONLY drive the worker
  // forward when the in-flight job was started by an explicit action in this
  // session (activeJobRef). Selecting an order or loading the page never starts
  // the worker — it only reads/refreshes.
  useEffect(() => {
    const status = summary?.batch.receiving_status
    const active = status === 'queued' || status === 'processing'
    if (!active || !selectedOrder) {
      setProcessing(false)
      activeJobRef.current = false
      return
    }
    setProcessing(true)
    setStartTime((prev) => prev || Date.now())

    // Read-only progress refresh (safe regardless of who started the job).
    const refreshInterval = setInterval(() => { loadSummary(selectedOrder, true) }, 3000)

    // Worker trigger is gated to this session's explicit job only.
    let workerInterval: NodeJS.Timeout | undefined
    if (activeJobRef.current) {
      fetch('/api/cron/warehouse-receiving-worker').catch(() => {})
      workerInterval = setInterval(() => {
        fetch('/api/cron/warehouse-receiving-worker').catch((e) => console.error('worker trigger failed', e))
      }, 8000)
    }

    return () => { clearInterval(refreshInterval); if (workerInterval) clearInterval(workerInterval) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary?.batch.receiving_status, selectedOrder])

  const fetchOrders = async () => {
    // Active orders are resolved server-side using the inventory receiving state
    // (ordered - cumulative received > 0). Fully received orders are excluded so
    // they cannot be selected/received again.
    try {
      const res = await fetch('/api/warehouse/active-orders')
      if (!res.ok) { console.error('Failed to load active orders'); return }
      const data = await res.json()
      setOrders(data.orders || [])
    } catch (e) {
      console.error('Error fetching active orders:', e)
    }
  }

  const loadSummary = async (orderId: string, silent = false) => {
    try {
      const res = await fetch(`/api/warehouse/receipt-summary?order_id=${orderId}`)
      if (!res.ok) {
        if (!silent) {
          const err = await res.json().catch(() => ({}))
          toast({ title: 'Failed to load order', description: err.error || 'Unknown error', variant: 'destructive' })
        }
        return
      }
      const data: Summary = await res.json()
      setSummary(data)
      // Seed receive-now inputs (default 0) for new variants
      setReceiveNow((prev) => {
        const next = { ...prev }
        for (const it of data.items) if (next[it.variant_id] === undefined) next[it.variant_id] = 0
        return next
      })
    } catch (e: any) {
      if (!silent) toast({ title: 'Failed to load order', description: e.message, variant: 'destructive' })
    }
  }

  const handleOrderSelect = async (orderId: string) => {
    setSelectedOrder(orderId)
    setSummary(null)
    setReceiveNow({})
    setRemarks('')
    setPostError(null)
    setStartTime(null)
    if (orderId) await loadSummary(orderId)
  }

  const fillRemaining = () => {
    if (!summary) return
    const next: Record<string, number> = {}
    for (const it of summary.items) next[it.variant_id] = it.ordered_balance
    setReceiveNow(next)
    toast({ title: 'Filled remaining ordered quantities', description: 'Adjust after physical counting if needed.' })
  }

  const refreshAll = async () => {
    if (selectedOrder) await loadSummary(selectedOrder)
    await fetchOrders()
  }

  // ---- Partial: Confirm Receipt -------------------------------------------
  const handleConfirmReceipt = async () => {
    if (!summary || submittingRef.current) return
    const items = summary.items
      .map((it) => ({ variant_id: it.variant_id, product_id: it.product_id, received_now: receiveNow[it.variant_id] || 0 }))
      .filter((i) => i.received_now > 0)

    if (items.length === 0) {
      toast({ title: 'Nothing to receive', description: 'Enter a quantity for at least one product.', variant: 'destructive' })
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    setPostError(null)
    // Reuse a stable key across retries of the same attempt; cleared on success.
    if (!pendingKeyRef.current) {
      pendingKeyRef.current = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`)
    }
    const idempotencyKey = pendingKeyRef.current
    try {
      const res = await fetch('/api/warehouse/confirm-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: summary.order.id,
          batch_id: summary.batch.id,
          receipt_type: 'partial',
          items,
          notes: remarks.trim().slice(0, 500) || undefined,
          idempotency_key: idempotencyKey,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to confirm receipt')

      // Inventory posted successfully -> this attempt is done; rotate the key.
      pendingKeyRef.current = null
      const r = data.receipt
      const seqMatch = String(r?.receipt_no || '').match(/-(\d+)$/)
      const grnNo = `GRN-${summary.order.display_doc_no || summary.order.order_no}-${seqMatch ? seqMatch[1] : ''}`
      toast({
        title: r?.idempotent_replay ? 'GRN already recorded' : `${grnNo} confirmed`,
        description: `Posted ${r?.total_received ?? 0} units to inventory.`,
      })
      // If this confirm queued the QR worker (first receipt), allow the polling
      // effect to drive it. Otherwise QR is already done -> no worker.
      if (data.qr_worker_triggered) {
        activeJobRef.current = true
        setStartTime(Date.now())
      }
      setReceiveNow((prev) => {
        const next = { ...prev }
        for (const it of summary.items) next[it.variant_id] = 0
        return next
      })
      setRemarks('')
      await refreshAll()
    } catch (e: any) {
      setPostError(e.message)
      toast({ title: 'Confirm failed', description: e.message, variant: 'destructive' })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  // ---- Full: Receive All (Order + Buffer) ---------------------------------
  const handleReceiveAll = async () => {
    if (!summary || submittingRef.current) return
    setShowFullConfirm(false)
    submittingRef.current = true
    setSubmitting(true)
    const idempotencyKey = `full-${summary.batch.id}`
    try {
      const res = await fetch('/api/warehouse/confirm-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: summary.order.id,
          batch_id: summary.batch.id,
          receipt_type: 'full',
          notes: remarks.trim().slice(0, 500) || undefined,
          idempotency_key: idempotencyKey,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start full receive')
      toast({ title: 'Receiving started', description: 'Processing full order + buffer…' })
      // Explicit action -> this session may drive the worker.
      if (data.qr_worker_triggered !== false) activeJobRef.current = true
      setStartTime(Date.now())
      await loadSummary(summary.order.id, true)
    } catch (e: any) {
      toast({ title: 'Receive All failed', description: e.message, variant: 'destructive' })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const handleViewHistory = async () => {
    if (!summary) return
    setShowHistory(true)
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/warehouse/receipt-history?order_id=${summary.order.id}`)
      const data = await res.json()
      setHistory(data.receipts || [])
      setHistoryOrder(data.order || null)
    } catch (e: any) {
      toast({ title: 'Failed to load history', description: e.message, variant: 'destructive' })
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleViewGlobalHistory = async () => {
    setShowGlobalHistory(true)
    setGlobalLoading(true)
    try {
      const res = await fetch('/api/warehouse/grn-history')
      const data = await res.json()
      setGlobalHistory(data.receipts || [])
    } catch (e: any) {
      toast({ title: 'Failed to load global history', description: e.message, variant: 'destructive' })
    } finally {
      setGlobalLoading(false)
    }
  }

  const handleReset = async () => {
    if (!summary) return
    if (!confirm('Reset this batch? This lets you restart the QR receiving process.')) return
    try {
      const res = await fetch('/api/warehouse/reset-receiving', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: summary.batch.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to reset')
      toast({ title: 'Reset successful', description: 'You can restart the process.' })
      setProcessing(false); setStartTime(null)
      await loadSummary(summary.order.id)
    } catch (e: any) {
      toast({ title: 'Reset failed', description: e.message, variant: 'destructive' })
    }
  }

  const b = summary?.batch
  const s = summary?.summary
  const masterPct = b && b.total_master_codes ? (b.received_master_codes / b.total_master_codes) * 100 : 0
  const uniquePct = b && b.total_unique_codes ? (b.received_unique_codes / b.total_unique_codes) * 100 : 0
  const isCompletedReceiving = s?.receipt_status === 'fully_received'
  const qrActive = b?.receiving_status === 'queued' || b?.receiving_status === 'processing'
  const canAct = !!summary && !processing && !submitting && !qrActive && !b?.is_stale && b?.receiving_status !== 'failed'

  const receiptStatusBadge = () => {
    if (!s) return null
    const map: Record<string, { label: string; cls: string }> = {
      not_started: { label: 'Not Started', cls: 'bg-gray-100 text-gray-700' },
      partially_received: { label: 'Partially Received', cls: 'bg-purple-100 text-purple-700' },
      fully_received: { label: 'Fully Received', cls: 'bg-green-100 text-green-700' },
    }
    const v = map[s.receipt_status]
    return <Badge className={`${v.cls} border-0`}>{v.label}</Badge>
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Warehouse Receive</h1>
          <p className="text-gray-500 mt-1">Receive and record inventory from manufacturer</p>
        </div>
        <Button variant="outline" onClick={handleViewGlobalHistory}>
          <Clock className="mr-2 h-4 w-4" /> Goods Received History (All Orders)
        </Button>
      </div>

      {/* 1. Order selector */}
      <Card>
        <CardHeader><CardTitle className="text-base">Select Order to Receive</CardTitle></CardHeader>
        <CardContent>
          <label className="text-xs text-gray-500 font-medium">Order Number</label>
          <select
            className="w-full p-2 border rounded-md mt-1"
            value={selectedOrder}
            onChange={(e) => handleOrderSelect(e.target.value)}
            disabled={processing}
          >
            <option value="">Select an order...</option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.display_doc_no || order.order_no} - {order.buyer_org?.org_name} ({new Date(order.created_at).toLocaleDateString()})
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {summary && b && s && (
        <>
          {/* Top metrics */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Metric label="Ordered Qty" value={s.ordered_qty} suffix="units" />
            <Metric label={`Expected Buffer (${summary.warranty_bonus_percent || 0}%)`} value={s.expected_buffer} suffix="units" tone="green" />
            <Metric label="Expected Total" value={s.expected_total} suffix="units" tone="indigo" />
            <Metric label="Inventory Received" value={s.inventory_received} suffix="units" tone="emerald" />
            <Metric label="Remaining Ordered" value={s.remaining_ordered} suffix="units" tone="amber" />
            <div className="p-4 rounded-lg border bg-white flex flex-col">
              <p className="text-xs text-gray-500 font-medium">Receipt Status</p>
              <div className="mt-2">{receiptStatusBadge()}</div>
            </div>
          </div>

          {!summary.receipt_tables_available && (
            <Alert className="bg-amber-50 border-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                Receipt tracking tables are not present in this database yet. Apply the
                <code className="mx-1">20260623_warehouse_received_*</code> migrations to enable partial receiving, receipt
                history and decoupled inventory posting.
              </AlertDescription>
            </Alert>
          )}

          {/* Separated status: QR processing vs inventory receipt */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border bg-white flex items-center justify-between">
              <span className="text-sm text-gray-500">QR Processing</span>
              {(() => {
                const st = b.receiving_status
                const map: Record<string, { label: string; cls: string }> = {
                  completed: { label: 'Completed', cls: 'bg-green-100 text-green-700' },
                  processing: { label: 'Processing', cls: 'bg-blue-100 text-blue-700' },
                  queued: { label: 'Queued', cls: 'bg-blue-100 text-blue-700' },
                  failed: { label: 'Failed', cls: 'bg-red-100 text-red-700' },
                  idle: { label: 'Not started', cls: 'bg-gray-100 text-gray-600' },
                }
                const v = map[st] || map.idle
                return <Badge className={`${v.cls} border-0`}>{v.label}</Badge>
              })()}
            </div>
            <div className="p-3 rounded-lg border bg-white flex items-center justify-between">
              <span className="text-sm text-gray-500">Inventory Receipt</span>
              {(() => {
                if (submitting) return <Badge className="bg-blue-100 text-blue-700 border-0">Posting…</Badge>
                if (postError) return <Badge className="bg-red-100 text-red-700 border-0">Posting Failed</Badge>
                const map: Record<string, { label: string; cls: string }> = {
                  not_started: { label: 'Pending / Not Posted', cls: 'bg-amber-100 text-amber-700' },
                  partially_received: { label: 'Partially Posted', cls: 'bg-purple-100 text-purple-700' },
                  fully_received: { label: 'Posted', cls: 'bg-green-100 text-green-700' },
                }
                const v = map[s.receipt_status]
                return <Badge className={`${v.cls} border-0`}>{v.label}</Badge>
              })()}
            </div>
          </div>

          {b.receiving_status === 'completed' && s.receipt_status === 'not_started' && !submitting && (
            <Alert className="bg-blue-50 border-blue-200">
              <AlertTriangle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800">
                QR processing is <b>completed</b> but inventory has <b>not been posted</b>. Enter actual quantities and
                click <b>Confirm Receipt</b> — the QR worker will not run again.
              </AlertDescription>
            </Alert>
          )}

          {postError && (
            <Alert className="bg-red-50 border-red-200">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-700">
                Inventory posting failed: {postError}. QR status is unaffected — you can safely retry Confirm Receipt.
              </AlertDescription>
            </Alert>
          )}

          {/* Quick actions */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Rocket className="h-4 w-4" />Quick Actions</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex flex-col items-center">
                  <Button variant="outline" className="w-full" onClick={fillRemaining} disabled={!canAct || isCompletedReceiving}>
                    <ListChecks className="mr-2 h-4 w-4" /> Fill Remaining Qty
                  </Button>
                  <span className="text-xs text-gray-400 mt-1">Fill ordered balance only</span>
                </div>
                <div className="flex flex-col items-center">
                  <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => setShowFullConfirm(true)} disabled={!canAct || isCompletedReceiving}>
                    <Rocket className="mr-2 h-4 w-4" /> Receive All (Order + Buffer)
                  </Button>
                  <span className="text-xs text-gray-400 mt-1">No item selection required. Full receive flow.</span>
                </div>
                <div className="flex flex-col items-center">
                  <Button variant="outline" className="w-full" onClick={handleViewHistory}>
                    <Clock className="mr-2 h-4 w-4" /> Goods Received History
                  </Button>
                  <span className="text-xs text-gray-400 mt-1">See all previous receipts (GRN)</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* QR processing progress (live) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>QR Processing Progress</span>
                {processing && (
                  <Badge variant="secondary" className="animate-pulse">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" /> {elapsedTime}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-xs text-blue-600 font-medium">Master Cases</p>
                  <p className="text-lg font-bold text-blue-900"><CountUp value={b.received_master_codes} /> / {b.total_master_codes.toLocaleString()}</p>
                  <Progress value={masterPct} className="h-1.5 mt-2" />
                </div>
                <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                  <p className="text-xs text-purple-600 font-medium">Unique Codes</p>
                  <p className="text-lg font-bold text-purple-900"><CountUp value={b.received_unique_codes} /> / {b.total_unique_codes.toLocaleString()}</p>
                  <Progress value={uniquePct} className="h-1.5 mt-2" />
                </div>
                <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                  <p className="text-xs text-green-600 font-medium">Warranty Buffer ({summary.warranty_bonus_percent || 0}%)</p>
                  <p className="text-lg font-bold text-green-900"><CountUp value={b.received_buffer_codes} /> / {b.buffer_codes.toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-2">Extra {summary.warranty_bonus_percent || 0}% from Manufacturer</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-100 flex flex-col justify-center items-center">
                  <p className="text-xs text-gray-500 font-medium mb-1">Current Status</p>
                  <Badge
                    variant={b.receiving_status === 'completed' ? 'default' : b.is_stale ? 'destructive' : 'outline'}
                    className={b.is_stale ? 'animate-pulse' : ''}
                  >
                    {b.is_stale ? 'STALE' : (b.receiving_status || 'idle')}
                  </Badge>
                  {b.receiving_status === 'processing' && b.receiving_heartbeat && (
                    <p className="text-xs text-gray-400 mt-1">
                      Heartbeat: {Math.round((Date.now() - new Date(b.receiving_heartbeat).getTime()) / 1000)}s ago
                    </p>
                  )}
                  {b.receiving_worker_id && <p className="text-xs text-gray-400">Worker: {b.receiving_worker_id}</p>}
                </div>
              </div>

              {(b.is_stale || b.receiving_status === 'failed' || (qrActive && !processing)) && (
                <div className="mt-4 flex flex-col items-center gap-3">
                  {b.is_stale && (
                    <Alert className="bg-red-50 border-red-200"><AlertTriangle className="h-4 w-4 text-red-600" />
                      <AlertDescription className="text-red-700">This batch appears stuck — no heartbeat for 3+ minutes. Click Reset to restart.</AlertDescription>
                    </Alert>
                  )}
                  {b.receiving_status === 'failed' && (
                    <Alert className="bg-red-50 border-red-200"><AlertTriangle className="h-4 w-4 text-red-600" />
                      <AlertDescription className="text-red-700">Processing failed. Click Reset to retry.</AlertDescription>
                    </Alert>
                  )}
                  <Button variant="outline" className="border-red-300 text-red-600 hover:bg-red-50" onClick={handleReset}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Reset
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Receive items + receipt summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Receive Items</CardTitle>
                <p className="text-xs text-gray-500">Enter the actual quantity you are receiving now. Values should reflect your physical count.</p>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 border-b">
                        <th className="py-2 pr-3">Product</th>
                        <th className="py-2 px-2 text-right">Ordered</th>
                        <th className="py-2 px-2 text-right">Prev. Received</th>
                        <th className="py-2 px-2 text-right">Receive Now</th>
                        <th className="py-2 px-2 text-right">Cumulative</th>
                        <th className="py-2 px-2 text-right">Balance</th>
                        <th className="py-2 pl-2 text-right">Extra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.items.map((it) => {
                        const now = receiveNow[it.variant_id] || 0
                        const cumulative = it.previously_received + now
                        const balance = Math.max(0, it.ordered_qty - cumulative)
                        const extra = Math.max(0, cumulative - it.ordered_qty)
                        return (
                          <tr key={it.variant_id} className="border-b last:border-0">
                            <td className="py-3 pr-3">
                              <div className="font-medium text-gray-900">{it.product_name}</div>
                              {it.variant_name && <div className="text-xs text-gray-500">[{it.variant_name}]</div>}
                            </td>
                            <td className="py-3 px-2 text-right">{it.ordered_qty.toLocaleString()}</td>
                            <td className="py-3 px-2 text-right">{it.previously_received.toLocaleString()}</td>
                            <td className="py-3 px-2 text-right">
                              <Input
                                type="number" min={0}
                                className="w-24 ml-auto text-right"
                                value={now}
                                disabled={!canAct || isCompletedReceiving}
                                onChange={(e) => setReceiveNow((prev) => ({ ...prev, [it.variant_id]: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                              />
                            </td>
                            <td className="py-3 px-2 text-right font-medium">{cumulative.toLocaleString()}</td>
                            <td className={`py-3 px-2 text-right ${balance === 0 ? 'text-green-600' : 'text-amber-600'}`}>{balance.toLocaleString()}</td>
                            <td className={`py-3 pl-2 text-right ${extra > 0 ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>{extra > 0 ? extra.toLocaleString() : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 pt-4 border-t">
                  <div className="text-sm text-gray-500 mb-3">
                    Total Receive Now:{' '}
                    <span className="font-bold text-blue-600">
                      {summary.items.reduce((sum, it) => sum + (receiveNow[it.variant_id] || 0), 0).toLocaleString()} units
                    </span>
                  </div>
                  <div className="flex flex-col md:flex-row gap-3 md:items-end">
                    <div className="flex-1">
                      <label className="text-xs text-gray-500 font-medium">Remarks (Optional)</label>
                      <textarea
                        className="w-full mt-1 p-2 border rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-200"
                        rows={2}
                        maxLength={500}
                        value={remarks}
                        disabled={!canAct || isCompletedReceiving}
                        placeholder="Add delivery condition, shortage, damage, supplier note, or other remarks..."
                        onChange={(e) => setRemarks(e.target.value)}
                      />
                      <div className="text-[11px] text-gray-400 text-right">{remarks.length}/500</div>
                    </div>
                    <Button className="bg-blue-600 hover:bg-blue-700 md:mb-5" onClick={handleConfirmReceipt} disabled={!canAct || isCompletedReceiving}>
                      {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirming…</> : <><CheckCircle className="mr-2 h-4 w-4" /> Confirm Receipt</>}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Receipt summary panel */}
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Receipt Summary</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Receipt Status" value={s.receipt_status.replace('_', ' ')} />
                <Row label="Received By" value={userProfile.email} icon={<UserIcon className="h-3.5 w-3.5" />} />
                <Row label="Receipt Date" value={fmtDate(new Date())} icon={<CalendarClock className="h-3.5 w-3.5" />} />
                <div className="border-t pt-3 space-y-2">
                  <Row label="Inventory Received" value={`${s.inventory_received.toLocaleString()} units`} />
                  <Row label="Remaining Ordered" value={`${s.remaining_ordered.toLocaleString()} units`} valueClass="text-amber-600" />
                  <Row label="Actual Extra Received" value={`${s.actual_extra_received.toLocaleString()} units`} valueClass={s.actual_extra_received > 0 ? 'text-blue-600' : ''} />
                </div>
                {isCompletedReceiving && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" /> Order fully received.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Receive All confirmation */}
      <Dialog open={showFullConfirm} onOpenChange={setShowFullConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Receive All (Order + Buffer)?</DialogTitle>
            <DialogDescription>
              This posts the complete ordered quantity{summary ? ` (${summary.summary.ordered_qty.toLocaleString()} units)` : ''} plus the
              expected warranty buffer{summary ? ` (${summary.summary.expected_buffer.toLocaleString()} units)` : ''} into inventory and marks the
              receipt as fully received. No item selection or manual counting is required.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFullConfirm(false)}>Cancel</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleReceiveAll}>Confirm Full Receive</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Goods Received History — per selected order */}
      <GoodsReceivedHistoryModal
        open={showHistory}
        onOpenChange={setShowHistory}
        loading={historyLoading}
        receipts={history}
        order={historyOrder}
        summaryData={s || null}
        fallbackOrderLabel={(() => {
          const o = orders.find((x) => x.id === selectedOrder)
          return o ? `${o.display_doc_no || o.order_no} - ${o.buyer_org?.org_name || ''} (${new Date(o.created_at).toLocaleDateString()})` : ''
        })()}
      />

      {/* Goods Received History — global / all orders (incl. fully received) */}
      <GoodsReceivedHistoryModal
        open={showGlobalHistory}
        onOpenChange={setShowGlobalHistory}
        loading={globalLoading}
        receipts={globalHistory}
        order={null}
        summaryData={null}
        fallbackOrderLabel=""
        global
      />
    </div>
  )
}

function Metric({ label, value, suffix, tone = 'gray' }: { label: string; value: number; suffix?: string; tone?: string }) {
  const tones: Record<string, string> = {
    gray: 'bg-white', green: 'bg-green-50 border-green-100', indigo: 'bg-indigo-50 border-indigo-100',
    emerald: 'bg-emerald-50 border-emerald-100', amber: 'bg-amber-50 border-amber-100',
  }
  return (
    <div className={`p-4 rounded-lg border ${tones[tone] || 'bg-white'}`}>
      <p className="text-xs text-gray-500 font-medium">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1"><CountUp value={value} /> {suffix && <span className="text-xs font-normal text-gray-400">{suffix}</span>}</p>
    </div>
  )
}

function Row({ label, value, icon, valueClass = '' }: { label: string; value: string; icon?: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500 flex items-center gap-1.5">{icon}{label}</span>
      <span className={`font-medium text-gray-900 ${valueClass}`}>{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Goods Received History modal
// ---------------------------------------------------------------------------
function HistoryCard({ icon, label, value, suffix, tone }: { icon: React.ReactNode; label: string; value: number; suffix?: string; tone: string }) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600', green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600', purple: 'bg-purple-50 text-purple-600',
    slate: 'bg-slate-100 text-slate-600',
  }
  return (
    <div className="p-4 rounded-xl border bg-white">
      <div className="flex items-center gap-2">
        <span className={`h-8 w-8 rounded-lg flex items-center justify-center ${tones[tone]}`}>{icon}</span>
        <span className="text-xs text-gray-500 font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900 mt-2">{value.toLocaleString()}</p>
      {suffix && <p className="text-xs text-gray-400">{suffix}</p>}
    </div>
  )
}

function TypeBadge({ type }: { type: string }) {
  const cls = type === 'full' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
  return <Badge className={`${cls} border-0 capitalize`}>{type}</Badge>
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    posted: 'bg-green-100 text-green-700', draft: 'bg-amber-100 text-amber-700', void: 'bg-red-100 text-red-700',
  }
  return <Badge className={`${map[status] || 'bg-gray-100 text-gray-700'} border-0 capitalize`}>{status}</Badge>
}

function GoodsReceivedHistoryModal({
  open, onOpenChange, loading, receipts, order, summaryData, fallbackOrderLabel, global = false,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  loading: boolean
  receipts: any[]
  order: any
  summaryData: Summary['summary'] | null
  fallbackOrderLabel: string
  global?: boolean
}) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [receivedByFilter, setReceivedByFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [expanded, setExpanded] = useState<string | null>(null)

  const colCount = global ? 10 : 9

  const receivers = useMemo(
    () => Array.from(new Set((receipts || []).map((r) => r.received_by_name).filter(Boolean))),
    [receipts],
  )

  const filtered = useMemo(() => {
    return (receipts || []).filter((r) => {
      const haystack = `${r.grn_no} ${r.legacy_ref} ${r.order_display_no || ''} ${r.supplier || ''}`.toLowerCase()
      if (search && !haystack.includes(search.toLowerCase())) return false
      if (typeFilter !== 'all' && r.receipt_type !== typeFilter) return false
      if (receivedByFilter !== 'all' && r.received_by_name !== receivedByFilter) return false
      if (dateFrom && r.received_at && new Date(r.received_at) < new Date(dateFrom)) return false
      if (dateTo && r.received_at && new Date(r.received_at) > new Date(dateTo + 'T23:59:59')) return false
      return true
    })
  }, [receipts, search, typeFilter, receivedByFilter, dateFrom, dateTo])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const startIdx = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const endIdx = Math.min(currentPage * pageSize, filtered.length)

  // Aggregates for the global view
  const agg = useMemo(() => ({
    totalReceived: filtered.reduce((s, r) => s + (r.total_received || 0), 0),
    partial: filtered.filter((r) => r.receipt_type === 'partial').length,
    full: filtered.filter((r) => r.receipt_type === 'full').length,
    orders: new Set(filtered.map((r) => r.order_id)).size,
  }), [filtered])

  const resetFilters = () => {
    setSearch(''); setTypeFilter('all'); setReceivedByFilter('all'); setDateFrom(''); setDateTo(''); setPage(1)
  }

  const exportCsv = () => {
    const header = global
      ? ['Order No', 'GRN No', 'Legacy Ref', 'Date & Time', 'Received By', 'Type', 'This Receipt', 'Cumulative', 'Status', 'Remarks']
      : ['GRN No', 'Legacy Ref', 'Date & Time', 'Received By', 'Type', 'This Receipt', 'Cumulative', 'Status', 'Remarks']
    const rows = filtered.map((r) => {
      const base = [
        r.grn_no, r.legacy_ref, r.received_at ? fmtDate(new Date(r.received_at)) : '',
        r.received_by_name || '', r.receipt_type, r.total_received ?? 0, r.cumulative_received ?? 0, r.posting_status,
        r.notes || '',
      ]
      return global ? [r.order_display_no || '', ...base] : base
    })
    const csv = [header, ...rows].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = global ? 'goods-received-all-orders.csv' : `goods-received-${order?.display_doc_no || 'order'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const orderDateStr = order?.order_date ? new Date(order.order_date).toLocaleDateString() : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl w-[96vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Goods Received History</DialogTitle>
          <DialogDescription>{global ? 'All goods received notes across orders' : 'Separate delivery records for this order'}</DialogDescription>
        </DialogHeader>

        {/* Order information strip (per-order view only) */}
        {!global && (
          <div className="rounded-xl border bg-white px-5 py-3">
            {order ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex items-center gap-2">
                  <span className="h-9 w-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"><FileText className="h-4 w-4" /></span>
                  <div>
                    <p className="text-xs text-gray-500">Order No.</p>
                    <p className="font-bold text-gray-900">{order.display_doc_no || order.order_no}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Supplier</p>
                  <p className="font-medium text-gray-800">{order.buyer_org_name || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Order Date</p>
                  <p className="font-medium text-gray-800">{orderDateStr || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Legacy Order Ref</p>
                  <p className="text-xs text-gray-400 mt-0.5">{order.order_no || '—'}</p>
                </div>
              </div>
            ) : (
              <span className="font-medium text-gray-800">{fallbackOrderLabel || '—'}</span>
            )}
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-gray-500"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
        ) : (
          <>
            {/* Summary cards */}
            {global ? (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <HistoryCard icon={<ScrollText className="h-4 w-4" />} label="Total Receipts" value={filtered.length} suffix="Receipts" tone="blue" />
                <HistoryCard icon={<PackageCheck className="h-4 w-4" />} label="Total Received" value={agg.totalReceived} suffix="Units" tone="green" />
                <HistoryCard icon={<Boxes className="h-4 w-4" />} label="Orders" value={agg.orders} suffix="Orders" tone="slate" />
                <HistoryCard icon={<PackageMinus className="h-4 w-4" />} label="Partial" value={agg.partial} suffix="Receipts" tone="purple" />
                <HistoryCard icon={<PackagePlus className="h-4 w-4" />} label="Full" value={agg.full} suffix="Receipts" tone="amber" />
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <HistoryCard icon={<Boxes className="h-4 w-4" />} label="Ordered Qty" value={summaryData?.ordered_qty || 0} suffix="Units" tone="blue" />
                <HistoryCard icon={<PackageCheck className="h-4 w-4" />} label="Total Received" value={summaryData?.inventory_received || 0} suffix="Units" tone="green" />
                <HistoryCard icon={<PackageMinus className="h-4 w-4" />} label="Remaining Ordered" value={summaryData?.remaining_ordered || 0} suffix="Units" tone="amber" />
                <HistoryCard icon={<PackagePlus className="h-4 w-4" />} label="Actual Extra Received" value={summaryData?.actual_extra_received || 0} suffix="Units" tone="purple" />
                <HistoryCard icon={<ScrollText className="h-4 w-4" />} label="Total Receipts" value={filtered.length} suffix="Receipts" tone="slate" />
              </div>
            )}

            {/* Filters */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-3 mt-2">
              <div className="flex-1 min-w-0 sm:min-w-[180px]">
                <div className="relative">
                  <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-2.5" />
                  <Input className="pl-8" placeholder={global ? 'Search Order / GRN No. / Supplier' : 'Search GRN No.'} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
                </div>
              </div>
              <div className="w-full sm:w-auto sm:min-w-[120px]">
                <label className="text-xs text-gray-500">Type</label>
                <select className="w-full p-2 border rounded-md text-sm mt-1" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}>
                  <option value="all">All</option>
                  <option value="partial">Partial</option>
                  <option value="full">Full</option>
                </select>
              </div>
              <div className="w-full sm:w-auto sm:min-w-[230px]">
                <label className="text-xs text-gray-500">Date Range (Received Date)</label>
                <div className="flex items-center gap-1 mt-1">
                  <Input type="date" className="text-sm min-w-0 flex-1" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} />
                  <span className="text-gray-400 text-xs shrink-0">–</span>
                  <Input type="date" className="text-sm min-w-0 flex-1" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} />
                </div>
              </div>
              <div className="w-full sm:w-auto sm:min-w-[140px]">
                <label className="text-xs text-gray-500">Received By</label>
                <select className="w-full p-2 border rounded-md text-sm mt-1" value={receivedByFilter} onChange={(e) => { setReceivedByFilter(e.target.value); setPage(1) }}>
                  <option value="all">All</option>
                  {receivers.map((rv) => <option key={rv} value={rv}>{rv}</option>)}
                </select>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Button variant="outline" className="w-full sm:w-auto" onClick={resetFilters}><RotateCcw className="mr-2 h-4 w-4" /> Reset</Button>
                <Button className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto" onClick={exportCsv} disabled={filtered.length === 0}><Download className="mr-2 h-4 w-4" /> Export</Button>
              </div>
            </div>

            {/* Table */}
            <div className="border rounded-lg overflow-x-auto mt-2">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr className="text-left">
                    <th className="py-2.5 px-2 w-10"></th>
                    {global && <th className="py-2.5 px-2">Order No.</th>}
                    <th className="py-2.5 px-2">GRN No.</th>
                    <th className="py-2.5 px-2">Date &amp; Time</th>
                    <th className="py-2.5 px-2">Received By</th>
                    <th className="py-2.5 px-2">Type</th>
                    <th className="py-2.5 px-2 text-right">This Receipt</th>
                    <th className="py-2.5 px-2 text-right">Cumulative</th>
                    <th className="py-2.5 px-2">Status</th>
                    <th className="py-2.5 px-2 w-10">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={colCount} className="py-10 text-center text-gray-400">No receipts found.</td></tr>
                  ) : pageRows.map((r) => {
                    const isOpen = expanded === r.id
                    const totals = (r.items || []).reduce(
                      (acc: any, it: any) => ({
                        now: acc.now + (it.received_now || 0),
                        cum: acc.cum + (it.cumulative_received || 0),
                        bal: acc.bal + (it.balance || 0),
                      }), { now: 0, cum: 0, bal: 0 })
                    return (
                      <Fragment key={r.id}>
                        <tr className="border-t hover:bg-gray-50/60">
                          <td className="px-2">
                            <button onClick={() => setExpanded(isOpen ? null : r.id)} className="p-1 rounded hover:bg-gray-100">
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </td>
                          {global && (
                            <td className="py-2.5 px-2">
                              <div className="font-medium text-gray-900">{r.order_display_no}</div>
                              <div className="text-xs text-gray-400">{r.supplier}</div>
                            </td>
                          )}
                          <td className="py-2.5 px-2">
                            <div className="font-semibold text-gray-900">{r.grn_no}</div>
                            <div className="text-xs text-gray-400">Legacy Ref: {r.legacy_ref}</div>
                          </td>
                          <td className="py-2.5 px-2 text-gray-600">{r.received_at ? fmtDate(new Date(r.received_at)) : '—'}</td>
                          <td className="py-2.5 px-2 text-gray-600">{r.received_by_name || '—'}</td>
                          <td className="py-2.5 px-2"><TypeBadge type={r.receipt_type} /></td>
                          <td className="py-2.5 px-2 text-right font-medium">{(r.total_received ?? 0).toLocaleString()}</td>
                          <td className="py-2.5 px-2 text-right font-medium">{(r.cumulative_received ?? 0).toLocaleString()}</td>
                          <td className="py-2.5 px-2"><StatusBadge status={r.posting_status} /></td>
                          <td className="px-2">
                            <button onClick={() => setExpanded(isOpen ? null : r.id)} className="p-1 rounded hover:bg-gray-100 text-gray-400">
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-gray-50/50">
                            <td colSpan={colCount} className="px-4 py-4">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Receipt Information */}
                                <div>
                                  <p className="text-sm font-semibold text-blue-700 mb-3">Receipt Information</p>
                                  <div className="space-y-2 text-sm">
                                    <Row label="GRN No." value={r.grn_no} />
                                    <Row label="Legacy Reference" value={r.legacy_ref} />
                                    <Row label="Received Date & Time" value={r.received_at ? fmtDate(new Date(r.received_at)) : '—'} />
                                    <Row label="Received By" value={r.received_by_name || '—'} />
                                    <Row label="Receipt Type" value={r.receipt_type} valueClass="capitalize" />
                                    <Row label="Status" value={r.posting_status} valueClass="capitalize" />
                                    <Row label="Remarks" value={r.notes || '—'} />
                                  </div>
                                </div>
                                {/* Line Items */}
                                <div>
                                  <p className="text-sm font-semibold text-blue-700 mb-3">Line Items</p>
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="text-left text-xs text-gray-500 border-b">
                                        <th className="py-1.5">Product</th>
                                        <th className="py-1.5 text-right">Received Now</th>
                                        <th className="py-1.5 text-right">Cumulative</th>
                                        <th className="py-1.5 text-right">Balance</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(r.items || []).map((it: any, idx: number) => (
                                        <tr key={idx} className="border-b last:border-0">
                                          <td className="py-2">
                                            {it.variant_code ? `${it.variant_code} ` : ''}{it.product_name}
                                            {it.variant_name ? <span className="text-gray-400"> [{it.variant_name}]</span> : ''}
                                          </td>
                                          <td className="py-2 text-right">{(it.received_now ?? 0).toLocaleString()}</td>
                                          <td className="py-2 text-right">{(it.cumulative_received ?? 0).toLocaleString()}</td>
                                          <td className="py-2 text-right">{(it.balance ?? 0).toLocaleString()}</td>
                                        </tr>
                                      ))}
                                      <tr className="font-semibold border-t-2">
                                        <td className="py-2">Total</td>
                                        <td className="py-2 text-right">{totals.now.toLocaleString()}</td>
                                        <td className="py-2 text-right">{totals.cum.toLocaleString()}</td>
                                        <td className="py-2 text-right">{totals.bal.toLocaleString()}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer / pagination */}
            <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
              <span className="text-sm text-gray-500">
                Showing {startIdx} to {endIdx} of {filtered.length} receipts
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                  <ChevronRight className="h-4 w-4 rotate-180" />
                </Button>
                <span className="text-sm px-2">{currentPage} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <select className="p-1.5 border rounded-md text-sm" value={pageSize} onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1) }}>
                  {[10, 20, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
