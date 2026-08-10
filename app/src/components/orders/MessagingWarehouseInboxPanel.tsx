'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface InboxItem {
  id: string
  order_id: string
  order_no: string | null
  source_channel: string
  status: string
  receipt_status?: string | null
  created_at: string
  delivery_method?: string | null
  delivery_reference?: string | null
}

interface PrepLine {
  orderItemId: string
  orderedQuantity: number
  preparedQuantity: number
  shortQuantity: number
  variantName: string
}

const DELIVERY_METHODS = [
  { value: 'lalamove', label: 'Lalamove' },
  { value: 'company_transport', label: 'Company Transport' },
  { value: 'distributor_self_pickup', label: 'Distributor Self Pickup' },
  { value: 'other', label: 'Other' },
] as const

/**
 * Warehouse incoming queue for messaging orders (after HQ approve).
 * Additive panel — classic Serapp holds / Current Orders stay unchanged.
 */
export function MessagingWarehouseInboxPanel() {
  const [items, setItems] = useState<InboxItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actorOrgType, setActorOrgType] = useState<string | null>(null)
  const [shipDraft, setShipDraft] = useState<Record<string, { method: string; reference: string }>>({})
  const [prepByOrder, setPrepByOrder] = useState<Record<string, PrepLine[]>>({})
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/messaging/warehouse-inbox')
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        if (res.status === 403) {
          setItems([])
          return
        }
        throw new Error(payload?.error || 'Unable to load messaging inbox.')
      }
      setItems((payload?.items || []) as InboxItem[])
      setActorOrgType(payload?.actor?.orgType || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load messaging inbox.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const loadPrep = async (orderId: string) => {
    const res = await fetch(`/api/messaging/preparation-items?orderId=${encodeURIComponent(orderId)}`)
    const payload = await res.json().catch(() => null)
    if (!res.ok) throw new Error(payload?.error || 'Unable to load lines.')
    setPrepByOrder((prev) => ({ ...prev, [orderId]: payload.lines || [] }))
    setExpandedOrderId(orderId)
  }

  const runAction = async (
    item: InboxItem,
    action: 'start_preparing' | 'ready_to_ship' | 'ship',
  ) => {
    setBusyId(item.order_id)
    setError(null)
    setNotice(null)
    try {
      const draft = shipDraft[item.order_id] || { method: 'lalamove', reference: '' }
      const res = await fetch('/api/messaging/warehouse-inbox/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: item.order_id,
          action,
          deliveryMethod: draft.method,
          deliveryReference: draft.reference || null,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Action failed.')

      if (action === 'ready_to_ship' && payload?.result?.status === 'awaiting_partial_confirmation') {
        setNotice(
          `${item.order_no || item.order_id.slice(0, 8)}: waiting for distributor to accept short quantities.`,
        )
      } else {
        const labels = {
          start_preparing: 'Preparation started',
          ready_to_ship: 'Marked ready to ship — stock reserved',
          ship: 'Shipped — inventory deducted and DO created',
        } as const
        setNotice(`${labels[action]} for ${item.order_no || item.order_id.slice(0, 8)}.`)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setBusyId(null)
    }
  }

  const savePrepared = async (item: InboxItem) => {
    const lines = prepByOrder[item.order_id] || []
    setBusyId(item.order_id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/messaging/warehouse-inbox/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: item.order_id,
          action: 'set_prepared_quantities',
          items: lines.map((line) => ({
            order_item_id: line.orderItemId,
            prepared_quantity: line.preparedQuantity,
          })),
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Save failed.')
      setNotice(`Prepared quantities saved for ${item.order_no || item.order_id.slice(0, 8)}.`)
      await load()
      await loadPrep(item.order_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusyId(null)
    }
  }

  const runResolve = async (item: InboxItem) => {
    setBusyId(item.order_id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/messaging/receipt/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: item.order_id }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Resolve failed.')
      setNotice(`Discrepancy resolved and invoice issued for ${item.order_no || item.order_id.slice(0, 8)}.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resolve failed.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return null
  if (!error && items.length === 0) return null

  return (
    <div className="mb-4 rounded-xl border border-[var(--sera-line)] bg-[var(--sera-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--sera-muted)]">
            Warehouse incoming · Messaging
          </p>
          <p className="mt-1 text-sm text-[var(--sera-ink)]">
            Prepare → optional short qty → Ready (lock qty) → Ship. Invoice after distributor receipt.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <ul className="mt-3 space-y-3">
        {items.map((item) => {
          const draft = shipDraft[item.order_id] || { method: 'lalamove', reference: '' }
          const busy = busyId === item.order_id
          const canEditPrep = ['pending_preparation', 'preparing', 'awaiting_partial_confirmation'].includes(item.status)
          const lines = prepByOrder[item.order_id] || []
          return (
            <li
              key={item.id}
              className="rounded-lg border border-[var(--sera-line)] px-3 py-3 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--sera-ink)]">
                    {item.order_no || item.order_id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-[var(--sera-muted)]">
                    {new Date(item.created_at).toLocaleString()} · {item.status.replace(/_/g, ' ')}
                    {item.receipt_status ? ` · receipt: ${item.receipt_status.replace(/_/g, ' ')}` : ''}
                  </p>
                  {item.receipt_status === 'discrepancy_pending' && (
                    <p className="mt-1 text-xs text-amber-800">
                      Open order details to review discrepancy line items before resolving.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    {item.source_channel}
                  </Badge>
                  <a
                    href={`/dashboard?view=view-order&order_id=${encodeURIComponent(item.order_id)}`}
                    className="text-xs font-semibold text-[var(--sera-orange)] hover:underline"
                  >
                    View order
                  </a>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {item.status === 'pending_preparation' && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void runAction(item, 'start_preparing')}
                  >
                    {busy ? 'Working…' : 'Start Preparing'}
                  </Button>
                )}
                {canEditPrep && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void loadPrep(item.order_id)}
                  >
                    Edit prepared qty
                  </Button>
                )}
                {(item.status === 'preparing' || item.status === 'pending_preparation' || item.status === 'awaiting_partial_confirmation') && (
                  <Button
                    type="button"
                    size="sm"
                    variant={item.status === 'preparing' ? 'default' : 'outline'}
                    disabled={busy || item.status === 'awaiting_partial_confirmation'}
                    title={
                      item.status === 'awaiting_partial_confirmation'
                        ? 'Waiting for distributor /accept_partial'
                        : undefined
                    }
                    onClick={() => void runAction(item, 'ready_to_ship')}
                  >
                    {busy ? 'Working…' : 'Ready to Ship (Reserve)'}
                  </Button>
                )}
              </div>

              {expandedOrderId === item.order_id && canEditPrep && lines.length > 0 && (
                <div className="mt-3 space-y-2 rounded-md border border-dashed border-[var(--sera-line)] p-3">
                  <p className="text-xs font-semibold text-[var(--sera-muted)]">Prepared quantities</p>
                  {lines.map((line) => (
                    <div key={line.orderItemId} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="min-w-[140px] flex-1 font-medium">{line.variantName}</span>
                      <span className="text-[var(--sera-muted)]">Ordered {line.orderedQuantity}</span>
                      <Input
                        className="h-8 w-24 text-xs"
                        type="number"
                        min={0}
                        max={line.orderedQuantity}
                        value={line.preparedQuantity}
                        onChange={(event) => {
                          const value = Math.max(0, Math.min(line.orderedQuantity, Number(event.target.value || 0)))
                          setPrepByOrder((prev) => ({
                            ...prev,
                            [item.order_id]: (prev[item.order_id] || []).map((row) =>
                              row.orderItemId === line.orderItemId
                                ? { ...row, preparedQuantity: value, shortQuantity: line.orderedQuantity - value }
                                : row,
                            ),
                          }))
                        }}
                      />
                    </div>
                  ))}
                  <Button type="button" size="sm" disabled={busy} onClick={() => void savePrepared(item)}>
                    {busy ? 'Saving…' : 'Save prepared qty'}
                  </Button>
                </div>
              )}

              {item.status === 'ready_to_ship' && (
                <div className="mt-3 space-y-2 rounded-md border border-dashed border-[var(--sera-line)] p-3">
                  <p className="text-xs font-semibold text-[var(--sera-muted)]">Ship / Dispatch</p>
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="h-9 rounded-md border border-[var(--sera-line)] bg-white px-2 text-xs"
                      value={draft.method}
                      onChange={(event) =>
                        setShipDraft((prev) => ({
                          ...prev,
                          [item.order_id]: { ...draft, method: event.target.value },
                        }))
                      }
                    >
                      {DELIVERY_METHODS.map((method) => (
                        <option key={method.value} value={method.value}>
                          {method.label}
                        </option>
                      ))}
                    </select>
                    <Input
                      className="h-9 max-w-[220px] text-xs"
                      placeholder="Tracking / delivery reference"
                      value={draft.reference}
                      onChange={(event) =>
                        setShipDraft((prev) => ({
                          ...prev,
                          [item.order_id]: { ...draft, reference: event.target.value },
                        }))
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      onClick={() => void runAction(item, 'ship')}
                    >
                      {busy ? 'Shipping…' : 'Ship / Dispatch'}
                    </Button>
                  </div>
                </div>
              )}
              {item.status === 'shipped' && item.receipt_status === 'discrepancy_pending' && actorOrgType === 'HQ' && (
                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void runResolve(item)}
                  >
                    {busy ? 'Resolving…' : 'Resolve discrepancy & issue invoice'}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
