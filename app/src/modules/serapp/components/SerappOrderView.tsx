'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Loader2, Send } from 'lucide-react'
import type { PasteMatchResult } from '@/components/orders/quick-order-matcher'
import type { SerappPasteCheckSummary } from '@/lib/serapp/paste-check-summary'
import { createClient } from '@/lib/supabase/client'
import { useSerapp } from './SerappContext'

interface PasteCheckResponse {
  sideEffects: string
  note: string
  summary: SerappPasteCheckSummary
  results: PasteMatchResult[]
  estimatedOrderValue: number
  fulfillmentWarehouse?: { id: string; name: string | null }
  distributor?: { id: string; org_name: string }
  error?: string
}

interface ConfirmResponse {
  ok: boolean
  order: {
    id: string
    order_no: string
    display_doc_no?: string | null
    status: string
  }
  hold?: {
    id: string
    status: string
    expires_at: string
    reserved_at: string
  } | null
  warning?: string
  confirmedLines: number
  skippedLines: number
  estimatedOrderValue: number
  fulfillmentWarehouse?: { id: string; name: string | null }
  note?: string
  error?: string
}

interface DistributorOption {
  id: string
  org_name: string
  org_code: string | null
}

const bucketStyle: Record<SerappPasteCheckSummary['bucket'], string> = {
  available: 'bg-[var(--sera-success-soft)] text-[var(--sera-success)] border border-[var(--sera-success)]/15',
  partially_available: 'bg-[var(--sera-warn-soft)] text-[var(--sera-warn)] border border-[var(--sera-warn)]/20',
  out_of_stock: 'bg-[var(--sera-danger-soft)] text-[var(--sera-danger)] border border-[var(--sera-danger)]/15',
  unmatched_or_review: 'bg-[var(--sera-mist)] text-[var(--sera-ink-soft)] border border-[var(--sera-line)]',
}

const lineStatusLabel = (result: PasteMatchResult) => {
  if (result.status === 'section_header') return `Section · ${result.sectionProductLine || result.name}`
  if (result.status === 'requires_review') return 'Requires Review'
  if (result.status === 'invalid_quantity') return 'Invalid Quantity'
  if (result.status === 'not_found') return 'Not Found'
  if (result.status === 'ambiguous') return 'Ambiguous'
  if (result.status === 'suggestion') return 'Suggestion'
  if (result.status === 'duplicate') return 'Duplicate'
  if (result.inventoryOutcome === 'insufficient_stock') return 'Insufficient Stock'
  if (result.inventoryOutcome === 'no_available_stock') return 'Out of Stock'
  if (result.inventoryOutcome === 'inventory_unclassified') return 'Unclassified Stock'
  if (result.status === 'matched' || result.status === 'alternative_match') return 'Matched'
  return result.status
}

export default function SerappOrderView() {
  const { userProfile, isHqSupport } = useSerapp()
  const [pasteText, setPasteText] = useState(
    'HERO\nBANANA VANILLA - 100\nGUAVA - 200\n\nZERO\nALMOND - 100\nTEA - 200',
  )
  const [busy, setBusy] = useState<'check' | 'confirm' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<PasteCheckResponse | null>(null)
  const [confirmed, setConfirmed] = useState<ConfirmResponse | null>(null)
  const [distributors, setDistributors] = useState<DistributorOption[]>([])
  const [distributorsLoading, setDistributorsLoading] = useState(false)
  const [selectedDistributorId, setSelectedDistributorId] = useState('')
  const idempotencyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isHqSupport) return
    let cancelled = false

    const loadDistributors = async () => {
      setDistributorsLoading(true)
      try {
        const supabase = createClient()
        const { data, error: queryError } = await supabase
          .from('organizations')
          .select('id, org_name, org_code')
          .eq('parent_org_id', userProfile.organization_id)
          .eq('org_type_code', 'DIST')
          .eq('is_active', true)
          .order('org_name')
          .limit(100)

        if (queryError) throw queryError
        if (!cancelled) {
          setDistributors((data || []) as DistributorOption[])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load distributors.')
        }
      } finally {
        if (!cancelled) setDistributorsLoading(false)
      }
    }

    void loadDistributors()
    return () => {
      cancelled = true
    }
  }, [isHqSupport, userProfile.organization_id])

  const needsDistributor = isHqSupport
  const hasDistributor = !needsDistributor || Boolean(selectedDistributorId)

  const canConfirm = useMemo(() => {
    if (!response || confirmed || !hasDistributor) return false
    return response.summary.bucket === 'available' || response.summary.bucket === 'partially_available'
  }, [response, confirmed, hasDistributor])

  const runCheck = async () => {
    if (!hasDistributor) {
      setError('Select a distributor first (HQ Support mode).')
      return
    }
    setBusy('check')
    setError(null)
    setConfirmed(null)
    idempotencyRef.current = null
    try {
      const res = await fetch('/api/serapp/paste-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pasteText,
          distributorId: selectedDistributorId || undefined,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.error || 'Paste & Check failed.')
      }
      setResponse(payload as PasteCheckResponse)
    } catch (err) {
      setResponse(null)
      setError(err instanceof Error ? err.message : 'Paste & Check failed.')
    } finally {
      setBusy(null)
    }
  }

  const runConfirm = async () => {
    if (!canConfirm) return
    setBusy('confirm')
    setError(null)
    try {
      if (!idempotencyRef.current) {
        idempotencyRef.current = typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `serapp-${Date.now()}-${Math.random().toString(36).slice(2)}`
      }

      const res = await fetch('/api/serapp/confirm-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pasteText,
          acceptAvailableOnly: true,
          idempotencyKey: idempotencyRef.current,
          distributorId: selectedDistributorId || undefined,
          fulfillmentWarehouseId: response?.fulfillmentWarehouse?.id || undefined,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.error || 'Confirm order failed.')
      }
      setConfirmed(payload as ConfirmResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirm order failed.')
    } finally {
      setBusy(null)
    }
  }

  const runCancelHold = async () => {
    if (!confirmed?.order?.id) return
    setBusy('cancel')
    setError(null)
    try {
      const res = await fetch('/api/serapp/cancel-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: confirmed.order.id }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Cancel failed.')
      setConfirmed({
        ...confirmed,
        order: { ...confirmed.order, status: 'cancelled' },
        hold: confirmed.hold
          ? { ...confirmed.hold, status: 'cancelled_by_distributor' }
          : null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-3 px-4 py-4">
        <div className="serapp-card serapp-rise rounded-2xl px-3.5 py-3 text-sm">
          <p className="serapp-eyebrow">Order</p>
          <p className="mt-1 font-display text-base font-semibold text-[var(--sera-ink)]">
            Paste & Check → Confirm
          </p>
          <p className="mt-1 text-[var(--sera-muted)]">
            Check first (no stock hold). Confirm creates a real D2H order and allocates stock, then starts a 1-hour warehouse acceptance window.
          </p>
        </div>

        {isHqSupport && (
          <div className="serapp-card serapp-rise rounded-2xl px-3.5 py-3 text-sm">
            <label htmlFor="serapp-distributor" className="serapp-eyebrow">
              Distributor (HQ Support)
            </label>
            <p className="mt-1 text-xs text-[var(--sera-muted)]">
              Choose which distributor this UAT order belongs to.
            </p>
            <select
              id="serapp-distributor"
              value={selectedDistributorId}
              disabled={distributorsLoading || busy !== null}
              onChange={(event) => {
                setSelectedDistributorId(event.target.value)
                setResponse(null)
                setConfirmed(null)
                setError(null)
                idempotencyRef.current = null
              }}
              className="mt-2 w-full rounded-xl border border-[var(--sera-line)] bg-[var(--sera-paper)] px-3 py-2.5 text-sm text-[var(--sera-ink)] outline-none focus:border-[var(--sera-orange)]"
            >
              <option value="">
                {distributorsLoading ? 'Loading distributors…' : 'Select distributor…'}
              </option>
              {distributors.map((dist) => (
                <option key={dist.id} value={dist.id}>
                  {dist.org_name}{dist.org_code ? ` (${dist.org_code})` : ''}
                </option>
              ))}
            </select>
            {!distributorsLoading && distributors.length === 0 && (
              <p className="mt-2 text-xs text-[var(--sera-danger)]">
                No active distributors found under this HQ.
              </p>
            )}
          </div>
        )}

        {confirmed && (
          <div className="serapp-rise rounded-2xl border border-[var(--sera-success)]/20 bg-[var(--sera-success-soft)] px-3.5 py-3 text-sm text-[var(--sera-success)] shadow-sm">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Order confirmed</p>
                <p className="mt-1">
                  {confirmed.order.display_doc_no || confirmed.order.order_no}
                  {' · '}
                  status {confirmed.order.status}
                </p>
                <p className="mt-1 text-xs opacity-90">
                  {confirmed.confirmedLines} lines confirmed
                  {confirmed.skippedLines > 0 ? ` · ${confirmed.skippedLines} skipped` : ''}
                  {confirmed.estimatedOrderValue > 0
                    ? ` · Estimated RM ${confirmed.estimatedOrderValue.toFixed(2)}`
                    : ''}
                </p>
                {confirmed.hold?.expires_at && confirmed.hold.status === 'active' && (
                  <p className="mt-2 rounded-xl bg-white/60 px-2 py-1.5 text-xs text-[var(--sera-warn)]">
                    Warehouse acceptance window ends at{' '}
                    <strong>{new Date(confirmed.hold.expires_at).toLocaleString()}</strong>.
                    If not accepted within 1 hour, stock is released automatically.
                  </p>
                )}
                {confirmed.hold?.status === 'cancelled_by_distributor' && (
                  <p className="mt-2 text-xs text-[var(--sera-danger)]">Hold cancelled — stock released.</p>
                )}
                {confirmed.warning && (
                  <p className="mt-2 text-xs text-[var(--sera-warn)]">{confirmed.warning}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/serapp/history" className="inline-block text-xs font-semibold underline">
                    View in Order History
                  </Link>
                  {confirmed.hold?.status === 'active' && confirmed.order.status === 'submitted' && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void runCancelHold()}
                      className="text-xs font-semibold text-[var(--sera-danger)] underline disabled:opacity-50"
                    >
                      {busy === 'cancel' ? 'Cancelling…' : 'Cancel before warehouse accepts'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {response && !confirmed && (
          <div className={`serapp-rise rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${bucketStyle[response.summary.bucket]}`}>
            <p className="font-semibold">{response.summary.label}</p>
            <p className="mt-1 text-xs opacity-90">
              {response.summary.availableLines} available · {response.summary.partialLines} partial ·{' '}
              {response.summary.outOfStockLines} OOS · {response.summary.reviewLines} review ·{' '}
              {response.summary.sectionHeaders} sections
            </p>
            {response.distributor?.org_name && (
              <p className="mt-1 text-xs opacity-90">Distributor: {response.distributor.org_name}</p>
            )}
            {response.fulfillmentWarehouse?.name && (
              <p className="mt-1 text-xs opacity-90">Warehouse: {response.fulfillmentWarehouse.name}</p>
            )}
            {response.estimatedOrderValue > 0 && (
              <p className="mt-1 text-xs opacity-90">
                Estimated value: RM {response.estimatedOrderValue.toFixed(2)} (not a final invoice)
              </p>
            )}
            {response.summary.bucket === 'partially_available' && (
              <p className="mt-2 text-xs opacity-90">
                Confirm will accept available quantities only and skip unresolved / out-of-stock lines.
              </p>
            )}
          </div>
        )}

        {response?.results?.map((result) => (
          <div
            key={`${result.line}-${result.raw}`}
            className="serapp-card serapp-rise rounded-2xl px-3.5 py-2.5 text-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--sera-ink)]">{result.raw}</p>
                {result.sectionProductLine && result.status !== 'section_header' && (
                  <p className="text-xs text-[var(--sera-muted)]">Scope: {result.sectionProductLine}</p>
                )}
              </div>
              <span className="shrink-0 rounded-lg bg-[var(--sera-mist)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--sera-muted)]">
                {lineStatusLabel(result)}
              </span>
            </div>
            {result.quantity != null && (
              <p className="mt-1 text-xs text-[var(--sera-muted)]">Qty: {result.quantity}</p>
            )}
          </div>
        ))}

        {error && (
          <div className="rounded-2xl border border-[var(--sera-danger)]/20 bg-[var(--sera-danger-soft)] px-3.5 py-2.5 text-sm text-[var(--sera-danger)] shadow-sm">
            {error}
          </div>
        )}
      </div>

      <div className="sticky bottom-16 z-30 border-t border-[var(--sera-line)] bg-[var(--sera-paper)]/95 px-3 py-3 backdrop-blur-md">
        <textarea
          value={pasteText}
          onChange={(event) => {
            setPasteText(event.target.value)
            setConfirmed(null)
            setResponse(null)
            idempotencyRef.current = null
          }}
          rows={5}
          placeholder={'HERO\nBANANA VANILLA - 100\nZERO\nALMOND - 100'}
          className="w-full resize-none rounded-2xl border border-[var(--sera-line)] bg-[var(--sera-surface)] px-3 py-2.5 text-sm text-[var(--sera-ink)] shadow-sm outline-none focus:border-[var(--sera-orange)]"
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy !== null || !pasteText.trim() || !hasDistributor}
            onClick={() => void runCheck()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--sera-ink)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-[var(--sera-ink-soft)]"
          >
            {busy === 'check' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Check
          </button>
          <button
            type="button"
            disabled={busy !== null || !canConfirm}
            onClick={() => void runConfirm()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--sera-orange)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-[var(--sera-orange-deep)]"
          >
            {busy === 'confirm' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Confirm
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-[var(--sera-muted)]">
          {needsDistributor && !hasDistributor
            ? 'Select a distributor above, then Check → Confirm.'
            : 'Confirm allocates stock now and starts a 1-hour warehouse acceptance window.'}
        </p>
      </div>
    </div>
  )
}
