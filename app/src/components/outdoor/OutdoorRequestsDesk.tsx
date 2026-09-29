'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  ORDER_REQUEST_MAX_REPLY,
  ORDER_REQUEST_STATUS_LABELS,
  ORDER_REQUEST_TRANSITIONS,
  ORDER_REQUEST_TYPE_LABELS,
  type OrderRequestStatus,
  type OrderRequestView,
} from '@/lib/storefront/order-requests'

const ACTION_LABELS: Record<OrderRequestStatus, string> = {
  new: 'New',
  reviewing: 'Start review',
  approved: 'Approve',
  rejected: 'Reject',
  refunded: 'Mark refunded',
  closed: 'Close',
}

const STATUS_STYLES: Record<OrderRequestStatus, string> = {
  new: 'bg-amber-100 text-amber-800',
  reviewing: 'bg-sky-100 text-sky-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
  refunded: 'bg-violet-100 text-violet-800',
  closed: 'bg-neutral-200 text-neutral-700',
}

export default function OutdoorRequestsDesk({ refreshKey }: { refreshKey: number }) {
  const [view, setView] = useState<'open' | 'all'>('open')
  const [requests, setRequests] = useState<OrderRequestView[]>([])
  const [available, setAvailable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [replies, setReplies] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/outdoor/requests?view=${view}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Failed to load requests')
      setAvailable(data.available !== false)
      setRequests(data.requests || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load requests')
    } finally {
      setLoading(false)
    }
  }, [view])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const update = async (request: OrderRequestView, status?: OrderRequestStatus) => {
    if (status === 'refunded' && !window.confirm('Refund the payment in the payment gateway first. Mark this request as refunded?')) return
    if (status === 'rejected' && !window.confirm('Reject this request? The customer will get an email.')) return
    setBusyId(request.id)
    setError('')
    try {
      const reply = replies[request.id]
      const res = await fetch('/api/outdoor/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: request.id, status, staffReply: reply !== undefined ? reply : undefined }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Update failed')
      setRequests((current) =>
        current
          .map((item) => (item.id === request.id ? data.request : item))
          .filter((item) => view === 'all' || ['new', 'reviewing', 'approved'].includes(item.status)),
      )
      setReplies((current) => {
        const next = { ...current }
        delete next[request.id]
        return next
      })
    } catch (err: any) {
      setError(err.message || 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        {([
          ['open', 'Open'],
          ['all', 'All requests'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setView(value)}
            className={`h-9 rounded-full px-3 text-xs font-semibold ${
              view === value ? 'bg-[var(--out-bark)] text-[var(--out-cream)]' : 'border border-[var(--out-line)]'
            }`}
          >
            {label}
          </button>
        ))}
        <p className="text-xs text-[var(--out-muted)]">
          Returns and problems customers report from My account. Refund the payment in the gateway first, then mark Refunded.
        </p>
      </div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="mt-10 text-sm text-[var(--out-muted)]">Loading…</p>
      ) : !available ? (
        <p className="mt-10 text-sm text-[var(--out-muted)]">
          Requests are not set up yet. Apply the storefront order requests migration on Supabase.
        </p>
      ) : requests.length === 0 ? (
        <p className="mt-10 text-sm text-[var(--out-muted)]">{view === 'open' ? 'No open requests.' : 'No requests yet.'}</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {requests.map((request) => {
            const busy = busyId === request.id
            const next = ORDER_REQUEST_TRANSITIONS[request.status] || []
            const reply = replies[request.id] ?? request.staffReply ?? ''
            const replyChanged = reply.trim() !== (request.staffReply || '')
            return (
              <li key={request.id} className="rounded-xl border border-[var(--out-line)] bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {ORDER_REQUEST_TYPE_LABELS[request.type]}{' '}
                      <span className="font-mono text-xs font-normal text-[var(--out-muted)]">{request.requestNo}</span>
                    </p>
                    <p className="mt-1 text-xs text-[var(--out-muted)]">
                      Order <span className="font-mono font-semibold text-[var(--out-ink)]">{request.orderRef}</span>
                      {request.orderStatus ? ` · ${request.orderStatus.replace(/_/g, ' ')}` : ''} ·{' '}
                      {new Date(request.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[request.status]}`}>
                    {ORDER_REQUEST_STATUS_LABELS[request.status]}
                  </span>
                </div>
                <p className="mt-3 text-sm">
                  {request.customerName || 'Customer'} ·{' '}
                  <a href={`mailto:${request.customerEmail}`} className="text-[var(--out-moss)] hover:underline">
                    {request.customerEmail}
                  </a>
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--out-ink-soft)]">{request.message}</p>
                {request.photos.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {request.photos.map((url, index) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="block h-20 w-20 overflow-hidden rounded-lg border border-[var(--out-line)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                ) : null}

                <label className="mt-4 block text-xs font-semibold text-[var(--out-muted)]">
                  Reply to customer (sent by email)
                  <textarea
                    value={reply}
                    onChange={(event) =>
                      setReplies((current) => ({ ...current, [request.id]: event.target.value.slice(0, ORDER_REQUEST_MAX_REPLY) }))
                    }
                    rows={2}
                    disabled={busy}
                    className="mt-1.5 w-full rounded-md border border-[var(--out-line)] px-3 py-2 text-sm font-normal text-[var(--out-ink)]"
                  />
                </label>

                <div className="mt-3 flex flex-wrap gap-2">
                  {next.map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={busy}
                      onClick={() => void update(request, status)}
                      className={`h-9 rounded-md px-3 text-xs font-semibold disabled:opacity-50 ${
                        status === 'approved' || status === 'refunded'
                          ? 'bg-[var(--out-moss)] text-white'
                          : 'border border-[var(--out-line)]'
                      }`}
                    >
                      {ACTION_LABELS[status]}
                    </button>
                  ))}
                  {replyChanged ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void update(request)}
                      className="h-9 rounded-md border border-[var(--out-moss)] px-3 text-xs font-semibold text-[var(--out-moss)] disabled:opacity-50"
                    >
                      Send reply only
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
