'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSerapp } from './SerappContext'

interface HistoryHold {
  id: string
  order_id: string
  status: string
  expires_at: string
  accepted_at: string | null
}

interface HistoryOrder {
  id: string
  order_no: string
  display_doc_no: string | null
  status: string
  notes: string | null
  created_at: string
  hold?: HistoryHold | null
  fromSerapp?: boolean
}

function holdLabel(hold: HistoryHold | null | undefined, orderStatus?: string) {
  if (!hold) return null
  // Prefer order truth when hold status was left inconsistent after approve.
  if (
    hold.status === 'cancelled_by_distributor' &&
    orderStatus &&
    ['approved', 'warehouse_packed', 'closed'].includes(orderStatus)
  ) {
    return 'Accepted · order already approved'
  }
  switch (hold.status) {
    case 'active':
      if (orderStatus && orderStatus !== 'submitted') {
        return 'Accepted · order already processed'
      }
      return `Hold until ${new Date(hold.expires_at).toLocaleString()}`
    case 'accepted':
      return 'Accepted · DO issued · approve in Current Orders'
    case 'expired':
      return 'Hold expired'
    case 'cancelled_by_distributor':
      return 'Cancelled by distributor'
    default:
      return hold.status
  }
}

function orderStatusLabel(status: string) {
  switch (status) {
    case 'submitted':
      return 'Submitted'
    case 'approved':
      return 'Approved · ready to ship'
    case 'warehouse_packed':
      return 'Packed / shipped'
    case 'closed':
      return 'Closed'
    case 'cancelled':
      return 'Cancelled'
    default:
      return status.replace(/_/g, ' ')
  }
}

function dashboardOrderHref(orderId: string, preferOrdersList = false) {
  const view = preferOrdersList ? 'orders' : 'view-order'
  return `/dashboard?view=${view}&order_id=${encodeURIComponent(orderId)}`
}

export default function SerappHistoryView() {
  const { isDistributor, isHqSupport } = useSerapp()
  const [orders, setOrders] = useState<HistoryOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/serapp/history')
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Unable to load order history.')
      setOrders((payload?.orders || []) as HistoryOrder[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load order history.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runCancel = async (orderId: string) => {
    setActionBusy(orderId)
    setError(null)
    try {
      const res = await fetch('/api/serapp/cancel-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Cancel failed.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed.')
    } finally {
      setActionBusy(null)
    }
  }

  const runAccept = async (orderId: string) => {
    setActionBusy(orderId)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/serapp/warehouse-accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || 'Accept failed.')
      const doLabel = payload?.do?.display_doc_no || payload?.do?.doc_no
      setNotice(
        doLabel
          ? `Hold accepted. Delivery Order ${doLabel} issued. Next: open Current Orders in Dashboard to approve (SO + Invoice).`
          : 'Hold accepted. Next: open Current Orders in Dashboard to approve.',
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accept failed.')
    } finally {
      setActionBusy(null)
    }
  }

  return (
    <div className="space-y-3 px-4 py-6">
      <div className="serapp-card serapp-rise rounded-2xl p-4">
        <p className="serapp-eyebrow">Order History</p>
        <h1 className="mt-2 font-display text-lg font-semibold text-[var(--sera-ink)]">
          {isHqSupport ? 'Pending Serapp holds' : 'Your recent D2H orders'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--sera-muted)]">
          {isHqSupport
            ? 'Accept holds here to issue DO. Then open Current Orders in the Dashboard to approve (SO + Invoice) and continue fulfillment.'
            : 'Serapp orders show a 1-hour warehouse acceptance hold. After accept, DO is issued automatically; remaining fulfillment continues in Current Orders.'}
        </p>
      </div>

      {loading && (
        <div className="serapp-card rounded-2xl px-4 py-6 text-center text-sm text-[var(--sera-muted)]">
          Loading orders…
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-[var(--sera-danger)]/20 bg-[var(--sera-danger-soft)] px-4 py-3 text-sm text-[var(--sera-danger)]">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-2xl border border-[var(--sera-success)]/25 bg-[var(--sera-success-soft)] px-4 py-3 text-sm text-[var(--sera-success)]">
          {notice}
        </div>
      )}

      {!loading && !error && orders.length === 0 && (
        <div className="serapp-card rounded-2xl px-4 py-6 text-center text-sm text-[var(--sera-muted)]">
          No orders yet. Confirm a list from the Products tab to see it here.
        </div>
      )}

      {orders.map((order) => {
        const fromSerapp = Boolean(order.fromSerapp)
        const holdText = holdLabel(order.hold, order.status)
        const canCancel =
          isDistributor &&
          order.hold?.status === 'active' &&
          order.status === 'submitted'
        const canAccept =
          isHqSupport &&
          order.hold?.status === 'active' &&
          order.status === 'submitted'
        const showDashboardLink =
          order.hold?.status === 'accepted' ||
          (order.fromSerapp && ['submitted', 'approved', 'warehouse_packed', 'closed'].includes(order.status))

        return (
          <div key={order.id} className="serapp-card serapp-rise rounded-2xl px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--sera-ink)]">
                  {order.display_doc_no || order.order_no}
                </p>
                <p className="mt-1 text-xs text-[var(--sera-muted)]">
                  {new Date(order.created_at).toLocaleString()}
                </p>
                {holdText && (
                  <p className={`mt-1.5 text-xs ${
                    order.hold?.status === 'active'
                      ? 'text-[var(--sera-warn)]'
                      : order.hold?.status === 'accepted'
                        ? 'text-[var(--sera-success)]'
                        : 'text-[var(--sera-muted)]'
                  }`}>
                    {holdText}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <span className="rounded-lg bg-[var(--sera-mist)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--sera-muted)]">
                  {orderStatusLabel(order.status)}
                </span>
                {fromSerapp && (
                  <p className="mt-1 text-[10px] font-semibold text-[var(--sera-orange)]">Serapp</p>
                )}
                {order.hold && (
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--sera-muted)]">
                    {order.hold.status.replace(/_/g, ' ')}
                  </p>
                )}
              </div>
            </div>

            {(canCancel || canAccept || showDashboardLink) && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-[var(--sera-line)] pt-3">
                {canAccept && (
                  <button
                    type="button"
                    disabled={actionBusy === order.id}
                    onClick={() => void runAccept(order.id)}
                    className="rounded-xl bg-[var(--sera-orange)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 hover:bg-[var(--sera-orange-deep)]"
                  >
                    {actionBusy === order.id ? 'Accepting…' : 'Accept hold'}
                  </button>
                )}
                {canCancel && (
                  <button
                    type="button"
                    disabled={actionBusy === order.id}
                    onClick={() => void runCancel(order.id)}
                    className="rounded-xl bg-[var(--sera-danger-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--sera-danger)] disabled:opacity-50"
                  >
                    {actionBusy === order.id ? 'Cancelling…' : 'Cancel hold'}
                  </button>
                )}
                {showDashboardLink && (
                  <a
                    href={dashboardOrderHref(order.id, isHqSupport)}
                    className="rounded-xl border border-[var(--sera-line)] bg-[var(--sera-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--sera-ink)] hover:border-[var(--sera-orange)]/40 hover:text-[var(--sera-orange)]"
                  >
                    {isHqSupport ? 'Open in Current Orders' : 'View in Current Orders'}
                  </a>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
