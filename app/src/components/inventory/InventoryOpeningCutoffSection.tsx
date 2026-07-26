'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Eye, History, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  canExecuteInventoryCutoff,
  inventoryCutoffReportCsv,
  type CutoffDecision,
  type CutoffReport,
} from '@/lib/inventory/inventory-cutoff'

interface Props {
  userProfile: any
  onOpenStockCount?: () => void
}

const localDateTime = () => {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export default function InventoryOpeningCutoffSection({ userProfile, onOpenStockCount }: Props) {
  const { supabase, isReady } = useSupabaseAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState<any[]>([])
  const [cutoffs, setCutoffs] = useState<any[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [selectedSession, setSelectedSession] = useState('')
  const [proposedAt, setProposedAt] = useState(localDateTime)
  const [report, setReport] = useState<CutoffReport | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [requestId, setRequestId] = useState('')
  const [otp, setOtp] = useState('')

  const isHqAdmin = userProfile?.organizations?.org_type_code === 'HQ'
    && Number(userProfile?.roles?.role_level) <= 10
  const activeCutoff = cutoffs.find(cutoff => cutoff.status === 'counting') || null

  const load = useCallback(async () => {
    if (!isReady) return
    setLoading(true)
    try {
      const [draftResult, cutoffResult, reportResult] = await Promise.all([
        (supabase as any).from('stock_count_sessions')
          .select('id,reference_name,count_date,warehouse_organization_id,updated_at')
          .eq('count_type', 'opening_balance_cutoff').eq('status', 'draft')
          .order('updated_at', { ascending: false }),
        (supabase as any).from('inventory_opening_cutoffs')
          .select('id,status,stock_count_session_id,warehouse_organization_id,proposed_cutoff_at,posted_at,created_at')
          .order('created_at', { ascending: false }),
        (supabase as any).from('inventory_cutoff_reports')
          .select('id,cutoff_id,readiness,report_payload,generated_at')
          .order('generated_at', { ascending: false }),
      ])
      if (draftResult.error) throw draftResult.error
      if (cutoffResult.error) throw cutoffResult.error
      if (reportResult.error) throw reportResult.error
      setDrafts(draftResult.data || [])
      setCutoffs(cutoffResult.data || [])
      setReports(reportResult.data || [])
      if (!selectedSession && draftResult.data?.[0]) setSelectedSession(draftResult.data[0].id)
    } catch (error: any) {
      toast({ title: 'Cut-off data unavailable', description: error.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [isReady, selectedSession, supabase, toast])

  useEffect(() => { void load() }, [load])

  const preview = useCallback(async (cutoffId = activeCutoff?.id) => {
    if (!cutoffId) return
    setBusy(true)
    try {
      const { data, error } = await (supabase as any).rpc('inventory_cutoff_preview', { p_cutoff_id: cutoffId })
      if (error) throw error
      setReport(data as CutoffReport)
    } catch (error: any) {
      toast({ title: 'Preview failed', description: error.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }, [activeCutoff?.id, supabase, toast])

  useEffect(() => {
    if (activeCutoff?.id && !report) void preview(activeCutoff.id)
  }, [activeCutoff?.id, preview, report])

  const startCutoff = async () => {
    if (!selectedSession) return
    setBusy(true)
    try {
      const { error } = await (supabase as any).rpc('start_inventory_opening_cutoff', {
        p_session_id: selectedSession,
        p_proposed_cutoff_at: new Date(proposedAt).toISOString(),
      })
      if (error) throw error
      toast({ title: 'Opening count activated', description: 'Warehouse inventory operations are now frozen.' })
      setReport(null)
      await load()
    } catch (error: any) {
      toast({ title: 'Could not start cut-off', description: error.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const decide = async (orderItemId: string, decision: CutoffDecision) => {
    if (!activeCutoff) return
    setBusy(true)
    try {
      const { error } = await (supabase as any).rpc('set_inventory_cutoff_decision', {
        p_cutoff_id: activeCutoff.id, p_order_item_id: orderItemId, p_decision: decision,
      })
      if (error) throw error
      await preview(activeCutoff.id)
    } catch (error: any) {
      toast({ title: 'Decision rejected', description: error.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const cancelAllEligible = async () => {
    if (!report) return
    const eligible = report.distributor_orders.filter(row => row.status === 'submitted')
    setBusy(true)
    try {
      for (const row of eligible) {
        const { error } = await (supabase as any).rpc('set_inventory_cutoff_decision', {
          p_cutoff_id: report.cutoff_id, p_order_item_id: row.order_item_id, p_decision: 'cancel_release',
        })
        if (error) throw error
      }
      await preview(report.cutoff_id)
    } catch (error: any) {
      toast({ title: 'Bulk decision stopped', description: error.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const requestVerification = async () => {
    if (!activeCutoff) return
    setBusy(true)
    try {
      const response = await fetch('/api/inventory/stock-count/verification/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeCutoff.stock_count_session_id }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Verification request failed')
      setRequestId(body.requestId)
      toast({ title: 'Verification code sent', description: `Sent to ${body.recipients?.join(', ') || 'authorized recipients'}.` })
    } catch (error: any) {
      toast({ title: 'Verification unavailable', description: error.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const execute = async () => {
    if (!activeCutoff || !requestId || !/^\d{8}$/.test(otp)) return
    setBusy(true)
    try {
      const response = await fetch('/api/inventory/stock-count/verification/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, sessionId: activeCutoff.stock_count_session_id, code: otp }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Cut-off failed')
      toast({ title: 'Go-live cut-off posted', description: 'Opening inventory is official and the warehouse freeze has been removed.' })
      setRequestId(''); setOtp(''); setReport(null)
      await load()
    } catch (error: any) {
      toast({ title: 'Cut-off not posted', description: error.message, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    if (!report) return
    const blob = new Blob([inventoryCutoffReportCsv(report)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `inventory-opening-cutoff-${report.cutoff_id}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const readinessColor = report?.readiness === 'Ready'
    ? 'bg-emerald-100 text-emerald-800'
    : report?.readiness === 'Blocked'
      ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
  const executable = canExecuteInventoryCutoff(report, isHqAdmin)
    && report?.cutoff_id === activeCutoff?.id
  const physicalSummary = useMemo(() => report?.inventory.reduce((sum, row) => sum + Number(row.physical_quantity || 0), 0) || 0, [report])

  return (
    <section className="overflow-hidden rounded-xl border-2 border-orange-300 bg-white shadow-sm" aria-labelledby="inventory-cutoff-title">
      <div className="bg-gradient-to-r from-orange-600 to-amber-500 p-5 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-100">Controlled posting workflow</p>
            <h2 id="inventory-cutoff-title" className="mt-1 text-2xl font-bold">Inventory Go-Live &amp; Cut-off</h2>
            <p className="mt-1 max-w-3xl text-sm text-orange-50">Make an Initial Stock Take the official opening balance while retaining all pre-cut-off history.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2 text-sm font-semibold">
            <ShieldCheck className="h-5 w-5" /> QR: Protected — No Impact
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900">
          Preview only — no inventory, order, allocation, or QR data will be changed.
        </div>

        {!activeCutoff && (
          <div className="grid gap-4 lg:grid-cols-[1fr_280px_auto] lg:items-end">
            <div>
              <Label>Existing Opening Balance Stock Count draft</Label>
              <Select value={selectedSession} onValueChange={setSelectedSession}>
                <SelectTrigger><SelectValue placeholder="Create and save an Opening Balance Cut-off count first" /></SelectTrigger>
                <SelectContent>{drafts.map(draft => (
                  <SelectItem key={draft.id} value={draft.id}>{draft.reference_name || draft.count_date} · {draft.warehouse_organization_id}</SelectItem>
                ))}</SelectContent>
              </Select>
              {drafts.length === 0 && <Button variant="link" className="h-auto p-0 text-orange-700" onClick={onOpenStockCount}>Open Stock Count to create the draft</Button>}
            </div>
            <div><Label>Proposed cut-off date/time</Label><Input type="datetime-local" value={proposedAt} onChange={event => setProposedAt(event.target.value)} /></div>
            <Button onClick={startCutoff} disabled={!selectedSession || busy || !isHqAdmin}><Lock className="mr-2 h-4 w-4" />Activate Count &amp; Freeze</Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void preview()} disabled={!activeCutoff || busy}><Eye className="mr-2 h-4 w-4" />Preview Cut-off Report</Button>
          <Button variant="outline" onClick={() => setShowHistory(value => !value)}><History className="mr-2 h-4 w-4" />View Previous Reports</Button>
          <Button variant="outline" onClick={download} disabled={!report}><Download className="mr-2 h-4 w-4" />Download CSV</Button>
          {busy && <Loader2 className="h-5 w-5 animate-spin text-orange-600" />}
        </div>

        {showHistory && <div className="rounded-lg border p-3 text-sm">
          {reports.length === 0 ? 'No posted cut-off reports.' : reports.map(item => (
            <button key={item.id} className="block w-full border-b p-2 text-left last:border-0" onClick={() => setReport(item.report_payload)}>
              {new Date(item.generated_at).toLocaleString()} · {item.readiness} · {item.cutoff_id}
            </button>
          ))}
        </div>}

        {report && <>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Go-live readiness</p><Badge className={readinessColor}>{report.readiness}</Badge></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Cut-off date/time</p><p className="font-semibold">{new Date(report.proposed_cutoff_at).toLocaleString()}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Warehouse / organization</p><p className="font-mono text-xs">{report.warehouse_organization_id}<br />{report.company_id}</p></div>
            <div className="rounded-lg border p-3"><p className="text-xs text-slate-500">Freeze / count draft</p><p className="font-semibold">{report.freeze_active ? 'Frozen — count active' : 'Open'} · Physical {physicalSummary.toLocaleString()}</p></div>
          </div>

          {(report.blockers.length > 0 || report.review_items.length > 0) && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
            <p className="font-semibold text-amber-950">Inventory freeze / readiness summary</p>
            {[...report.blockers, ...report.review_items].map((message, index) => <p key={index} className="mt-1 flex gap-2 text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{message}</p>)}
          </div>}

          <div>
            <h3 className="mb-2 font-semibold">Existing Stock Count draft summary</h3>
            <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Variant</TableHead><TableHead>Stock configuration</TableHead><TableHead className="text-right">System</TableHead><TableHead className="text-right">Physical</TableHead><TableHead className="text-right">Variance</TableHead><TableHead className="text-right">Allocated</TableHead></TableRow></TableHeader>
              <TableBody>{report.inventory.map(row => <TableRow key={row.stock_config_id}><TableCell>{row.variant_name}</TableCell><TableCell>{row.stock_configuration}</TableCell><TableCell className="text-right">{row.system_quantity}</TableCell><TableCell className="text-right">{row.physical_quantity ?? 'Missing'}</TableCell><TableCell className="text-right">{row.variance ?? '—'}</TableCell><TableCell className="text-right">{row.allocated_quantity}</TableCell></TableRow>)}</TableBody>
            </Table></div>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Distributor order decisions</h3><Button size="sm" variant="destructive" onClick={cancelAllEligible} disabled={busy}>Do Not Carry Forward — Cancel Eligible Orders &amp; Release Allocations</Button></div>
            <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Order / status</TableHead><TableHead>Customer / warehouse</TableHead><TableHead>Variant / quantity</TableHead><TableHead>Classification</TableHead><TableHead>Decision</TableHead></TableRow></TableHeader>
              <TableBody>{report.distributor_orders.map(row => <TableRow key={row.order_item_id}><TableCell>{row.order_number}<br /><Badge variant="outline">{row.status}</Badge></TableCell><TableCell>{row.customer}<br /><span className="text-xs text-slate-500">{row.warehouse}</span></TableCell><TableCell>{row.variant} · {row.quantity}</TableCell><TableCell>{row.classification}</TableCell><TableCell>{row.status === 'submitted' ? <Select value={row.decision || ''} onValueChange={value => void decide(row.order_item_id, value as CutoffDecision)}><SelectTrigger className="w-52"><SelectValue placeholder="Choose action" /></SelectTrigger><SelectContent><SelectItem value="carry_forward">Carry Forward</SelectItem><SelectItem value="cancel_release">Cancel &amp; Release</SelectItem></SelectContent></Select> : 'Not cancellable'}</TableCell></TableRow>)}</TableBody>
            </Table></div>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Manufacturer incoming decisions</h3>
            <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Order / status</TableHead><TableHead>Manufacturer</TableHead><TableHead>Variant</TableHead><TableHead>Remaining incoming</TableHead><TableHead>Selected configuration</TableHead><TableHead>Decision</TableHead></TableRow></TableHeader>
              <TableBody>{report.manufacturer_incoming.map(row => <TableRow key={row.order_item_id}><TableCell>{row.order_number}<br /><Badge variant="outline">{row.status}</Badge></TableCell><TableCell>{row.manufacturer}</TableCell><TableCell>{row.variant}</TableCell><TableCell>{row.remaining_incoming_quantity}</TableCell><TableCell>{row.stock_configuration || <span className="text-red-700">Missing — blocked</span>}</TableCell><TableCell><Button size="sm" variant={row.decision ? 'default' : 'outline'} disabled={!row.stock_config_id || busy} onClick={() => void decide(row.order_item_id, 'carry_forward_incoming')}>{row.decision ? <CheckCircle2 className="mr-2 h-4 w-4" /> : null}Carry Forward as Incoming</Button></TableCell></TableRow>)}</TableBody>
            </Table></div>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Transfers, repacks, returns, adjustments &amp; receiving</h3>
            <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>Transaction</TableHead><TableHead>Reference</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Quantity</TableHead><TableHead>Classification</TableHead><TableHead>Date/time</TableHead></TableRow></TableHeader>
              <TableBody>{report.warehouse_activity.length === 0
                ? <TableRow><TableCell colSpan={6} className="text-center text-slate-500">No relevant open or recent warehouse transactions.</TableCell></TableRow>
                : report.warehouse_activity.map((row, index) => <TableRow key={`${row.reference_no}-${index}`}><TableCell>{row.movement_type}</TableCell><TableCell>{row.reference_no || '—'}</TableCell><TableCell>{row.status || 'posted'}</TableCell><TableCell className="text-right">{row.quantity}</TableCell><TableCell>{row.classification}</TableCell><TableCell>{new Date(row.occurred_at).toLocaleString()}</TableCell></TableRow>)}</TableBody>
            </Table></div>
          </div>

          <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div><p className="font-semibold">Execute Go-Live Cut-off</p><p className="text-sm text-slate-600">HQ Admin only. Server readiness is rechecked atomically after OTP verification.</p></div>
              {!requestId ? <Button onClick={requestVerification} disabled={!executable || busy}>Request OTP</Button> : <div className="flex items-end gap-2"><div><Label>8-digit verification code</Label><Input value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 8))} className="w-52 font-mono tracking-widest" /></div><Button className="bg-red-700 hover:bg-red-800" onClick={execute} disabled={!executable || otp.length !== 8 || busy}>Execute Go-Live Cut-off</Button></div>}
            </div>
          </div>
        </>}
        {loading && <p className="text-sm text-slate-500">Loading Inventory Go-Live &amp; Cut-off…</p>}
      </div>
    </section>
  )
}
