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

      const labels = {
        start_preparing: 'Preparation started',
        ready_to_ship: 'Marked ready to ship — stock reserved',
        ship: 'Shipped — inventory deducted and DO created',
      } as const
      setNotice(`${labels[action]} for ${item.order_no || item.order_id.slice(0, 8)}.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.')
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
            HQ-approved Telegram/WhatsApp orders. Reserve at Ready to Ship; deduct on Ship; invoice after receipt.
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
                {(item.status === 'preparing' || item.status === 'pending_preparation') && (
                  <Button
                    type="button"
                    size="sm"
                    variant={item.status === 'preparing' ? 'default' : 'outline'}
                    disabled={busy}
                    onClick={() => void runAction(item, 'ready_to_ship')}
                  >
                    {busy ? 'Working…' : 'Ready to Ship (Reserve)'}
                  </Button>
                )}
              </div>

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
