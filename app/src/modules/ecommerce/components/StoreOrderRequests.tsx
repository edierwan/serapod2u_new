'use client'

import { useCallback, useEffect, useState } from 'react'
import { LifeBuoy, Loader2 } from 'lucide-react'
import {
    ORDER_REQUEST_MAX_REPLY,
    ORDER_REQUEST_STATUS_LABELS,
    ORDER_REQUEST_TRANSITIONS,
    ORDER_REQUEST_TYPE_LABELS,
    isOpenOrderRequest,
    type OrderRequestStatus,
    type OrderRequestView,
} from '@/lib/storefront/order-requests'

type RequestWithOrder = OrderRequestView & { order?: any }

const ACTION_LABELS: Record<OrderRequestStatus, string> = {
    new: 'New',
    reviewing: 'Start review',
    approved: 'Approve',
    rejected: 'Reject',
    refunded: 'Mark refunded',
    closed: 'Close',
}

const STATUS_STYLES: Record<OrderRequestStatus, string> = {
    new: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    reviewing: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
    rejected: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800',
    refunded: 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
    closed: 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800/50 dark:text-gray-300 dark:border-gray-700',
}

export function OrderRequestBadge({ status }: { status: OrderRequestStatus }) {
    return (
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[status]}`}>
            <LifeBuoy className="h-3 w-3" />
            Request · {ORDER_REQUEST_STATUS_LABELS[status]}
        </span>
    )
}

/** Latest open request per order id, for the visible page of orders. */
export function useOpenRequestsByOrder(orderIds: string[], refreshKey: number) {
    const [byOrder, setByOrder] = useState<Record<string, OrderRequestStatus>>({})
    const key = orderIds.join(',')

    useEffect(() => {
        if (!key) {
            setByOrder({})
            return
        }
        let cancelled = false
        void fetch(`/api/admin/store/requests?orderIds=${encodeURIComponent(key)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled || !data) return
                const next: Record<string, OrderRequestStatus> = {}
                for (const request of (data.requests || []) as OrderRequestView[]) {
                    if (isOpenOrderRequest(request.status) && !next[request.orderId]) next[request.orderId] = request.status
                }
                setByOrder(next)
            })
            .catch(() => undefined)
        return () => {
            cancelled = true
        }
    }, [key, refreshKey])

    return byOrder
}

function useRequestUpdater(onChanged: (request: OrderRequestView) => void) {
    const [busyId, setBusyId] = useState<string | null>(null)
    const [error, setError] = useState('')

    const update = async (request: OrderRequestView, status: OrderRequestStatus | undefined, reply: string | undefined) => {
        if (status === 'refunded' && !confirm('Refund the payment in the payment gateway first. Mark this request as refunded?')) return
        if (status === 'rejected' && !confirm('Reject this request? The customer will get an email.')) return
        setBusyId(request.id)
        setError('')
        try {
            const res = await fetch('/api/admin/store/requests', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: request.id, status, staffReply: reply }),
            })
            const data = await res.json().catch(() => null)
            if (!res.ok) throw new Error(data?.error || 'Update failed')
            onChanged(data.request)
            return data.request as OrderRequestView
        } catch (err: any) {
            setError(err.message || 'Update failed')
        } finally {
            setBusyId(null)
        }
    }

    return { busyId, error, update }
}

/** Open customer requests across all orders, shown above the orders table. */
export function StoreOpenRequestsPanel({
    refreshKey,
    onOpenOrder,
}: {
    refreshKey: number
    onOpenOrder: (order: any) => void
}) {
    const [requests, setRequests] = useState<RequestWithOrder[]>([])

    useEffect(() => {
        let cancelled = false
        void fetch('/api/admin/store/requests?open=1')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled && data) setRequests(data.requests || [])
            })
            .catch(() => undefined)
        return () => {
            cancelled = true
        }
    }, [refreshKey])

    if (requests.length === 0) return null

    return (
        <div className="sera-sc-panel p-4">
            <div className="flex items-center gap-2">
                <LifeBuoy className="h-4 w-4 text-amber-600" />
                <h3 className="text-sm font-semibold text-foreground">Customer requests waiting</h3>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                    {requests.length}
                </span>
            </div>
            <ul className="mt-3 divide-y divide-border">
                {requests.map((request) => (
                    <li key={request.id}>
                        <button
                            type="button"
                            disabled={!request.order}
                            onClick={() => request.order && onOpenOrder(request.order)}
                            className="flex w-full flex-wrap items-center justify-between gap-2 py-2.5 text-left hover:bg-accent/20 disabled:cursor-default"
                        >
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">
                                    {ORDER_REQUEST_TYPE_LABELS[request.type]}
                                    <span className="ml-2 font-mono text-xs text-muted-foreground">{request.orderRef}</span>
                                    {request.salesChannel === 'outdoor' ? (
                                        <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Outdoor</span>
                                    ) : null}
                                </p>
                                <p className="truncate text-xs text-muted-foreground max-w-[520px]">
                                    {request.customerName || request.customerEmail} · {request.message}
                                </p>
                            </div>
                            <OrderRequestBadge status={request.status} />
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    )
}

/** Requests for one order, inside the order detail panel. */
export function StoreOrderRequestsSection({
    orderId,
    onChanged,
}: {
    orderId: string
    onChanged: () => void
}) {
    const [requests, setRequests] = useState<OrderRequestView[]>([])
    const [loading, setLoading] = useState(true)
    const [replies, setReplies] = useState<Record<string, string>>({})

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`/api/admin/store/requests?orderIds=${encodeURIComponent(orderId)}`)
            const data = res.ok ? await res.json() : null
            setRequests(data?.requests || [])
        } catch {
            setRequests([])
        } finally {
            setLoading(false)
        }
    }, [orderId])

    useEffect(() => {
        void load()
    }, [load])

    const { busyId, error, update } = useRequestUpdater((updated) => {
        setRequests((current) => current.map((item) => (item.id === updated.id ? updated : item)))
        setReplies((current) => {
            const next = { ...current }
            delete next[updated.id]
            return next
        })
        onChanged()
    })

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading customer requests…
            </div>
        )
    }
    if (requests.length === 0) return null

    return (
        <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Customer requests</h3>
            <div className="space-y-3">
                {requests.map((request) => {
                    const busy = busyId === request.id
                    const reply = replies[request.id] ?? request.staffReply ?? ''
                    const replyChanged = reply.trim() !== (request.staffReply || '')
                    const sendReply = replies[request.id] !== undefined ? reply : undefined
                    return (
                        <div key={request.id} className="bg-accent/40 rounded-lg p-3 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-medium text-foreground">
                                    {ORDER_REQUEST_TYPE_LABELS[request.type]}
                                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">{request.requestNo}</span>
                                </p>
                                <OrderRequestBadge status={request.status} />
                            </div>
                            <p className="text-[11px] text-muted-foreground">{new Date(request.createdAt).toLocaleString('en-MY')}</p>
                            <p className="text-sm text-foreground whitespace-pre-wrap">{request.message}</p>
                            {request.photos.length ? (
                                <div className="flex flex-wrap gap-2">
                                    {request.photos.map((url, index) => (
                                        <a key={url} href={url} target="_blank" rel="noreferrer" className="block h-16 w-16 overflow-hidden rounded-md border border-border">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={url} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />
                                        </a>
                                    ))}
                                </div>
                            ) : null}
                            <textarea
                                value={reply}
                                onChange={(e) => setReplies((current) => ({ ...current, [request.id]: e.target.value.slice(0, ORDER_REQUEST_MAX_REPLY) }))}
                                rows={2}
                                disabled={busy}
                                placeholder="Reply to the customer (sent by email)"
                                className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm"
                            />
                            <div className="flex flex-wrap gap-2">
                                {(ORDER_REQUEST_TRANSITIONS[request.status] || []).map((status) => (
                                    <button
                                        key={status}
                                        type="button"
                                        disabled={busy}
                                        onClick={() => void update(request, status, sendReply)}
                                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50"
                                    >
                                        {ACTION_LABELS[status]}
                                    </button>
                                ))}
                                {replyChanged ? (
                                    <button
                                        type="button"
                                        disabled={busy}
                                        onClick={() => void update(request, undefined, reply)}
                                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-50"
                                    >
                                        Send reply only
                                    </button>
                                ) : null}
                            </div>
                            {request.status === 'approved' ? (
                                <p className="text-[11px] text-muted-foreground">
                                    Refund the payment in the gateway first, then mark Refunded. For a full refund you can also set the order status to Refunded.
                                </p>
                            ) : null}
                        </div>
                    )
                })}
            </div>
            {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>
    )
}
