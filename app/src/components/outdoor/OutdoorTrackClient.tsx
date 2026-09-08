'use client'

import { useState } from 'react'

type TrackedOrder = {
  orderRef: string
  status: string
  totalAmount: number
  currency: string
  customerName: string
  paidAt: string | null
  createdAt: string
  shippingAddress: any
  shippingCourierName?: string | null
  shippingTrackingNo?: string | null
  courierLatestStatus?: string | null
  courierEvents?: Array<{
    status: string
    date: string | null
    location: string | null
    remark: string | null
  }>
  items: Array<{
    productName: string
    variantName: string
    quantity: number
    unitPrice: number
    subtotal: number
  }>
}

function money(amount: number, currency = 'MYR') {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency }).format(amount)
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ')
}

export default function OutdoorTrackClient() {
  const [orderRef, setOrderRef] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [order, setOrder] = useState<TrackedOrder | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setOrder(null)
    try {
      const res = await fetch('/api/storefront/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderRef, email }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Lookup failed')
      setOrder(data.order)
    } catch (err: any) {
      setError(err.message || 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 sm:px-8 py-16 sm:py-20">
      <h1 className="font-display text-4xl sm:text-5xl tracking-tight">Track Order</h1>
      <p className="mt-4 text-[var(--out-muted)] leading-relaxed">
        Enter your order reference and the email used at checkout.
      </p>

      <form className="mt-8 space-y-4" onSubmit={submit}>
        <label className="block text-sm">
          Order reference
          <input
            required
            value={orderRef}
            onChange={(e) => setOrderRef(e.target.value)}
            placeholder="ORD-…"
            className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] bg-white px-3"
          />
        </label>
        <label className="block text-sm">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] bg-white px-3"
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="h-11 rounded-md bg-[var(--out-moss)] px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Track order'}
        </button>
      </form>

      {order ? (
        <div className="mt-10 rounded-2xl border border-[var(--out-line)] bg-white p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--out-muted)]">Order</p>
              <p className="font-mono text-lg font-semibold">{order.orderRef}</p>
            </div>
            <span className="rounded-full bg-[var(--out-moss)]/10 px-3 py-1 text-xs font-semibold uppercase text-[var(--out-moss-deep)]">
              {statusLabel(order.status)}
            </span>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <p><span className="text-[var(--out-muted)]">Placed:</span> {new Date(order.createdAt).toLocaleString()}</p>
            <p><span className="text-[var(--out-muted)]">Total:</span> {money(order.totalAmount, order.currency)}</p>
            <p><span className="text-[var(--out-muted)]">Customer:</span> {order.customerName}</p>
            <p><span className="text-[var(--out-muted)]">Paid at:</span> {order.paidAt ? new Date(order.paidAt).toLocaleString() : 'Pending verification'}</p>
            {order.shippingCourierName ? (
              <p><span className="text-[var(--out-muted)]">Courier:</span> {order.shippingCourierName}</p>
            ) : null}
            {order.shippingTrackingNo ? (
              <p><span className="text-[var(--out-muted)]">Tracking:</span> <span className="font-mono font-medium">{order.shippingTrackingNo}</span></p>
            ) : null}
            {order.courierLatestStatus ? (
              <p className="sm:col-span-2"><span className="text-[var(--out-muted)]">Courier status:</span> {order.courierLatestStatus}</p>
            ) : null}
          </div>
          <div>
            <p className="text-sm font-semibold mb-2">Items</p>
            <ul className="space-y-2 text-sm">
              {order.items.map((item, i) => (
                <li key={`${item.productName}-${i}`} className="flex justify-between gap-3 border-t border-[var(--out-line)] pt-2">
                  <span>{item.productName} · {item.variantName} × {item.quantity}</span>
                  <span className="font-medium">{money(item.subtotal, order.currency)}</span>
                </li>
              ))}
            </ul>
          </div>
          {order.courierEvents && order.courierEvents.length > 0 ? (
            <div>
              <p className="text-sm font-semibold mb-2">Shipment updates</p>
              <ul className="space-y-2 text-sm border-t border-[var(--out-line)] pt-3">
                {order.courierEvents.map((ev, i) => (
                  <li key={`${ev.status}-${i}`} className="flex flex-col sm:flex-row sm:justify-between gap-1">
                    <span>{ev.status}{ev.location ? ` · ${ev.location}` : ''}</span>
                    <span className="text-[var(--out-muted)] text-xs">{ev.date || ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : !order.shippingTrackingNo ? (
            <p className="text-xs text-[var(--out-muted)]">
              Courier tracking appears here after the order is shipped.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
