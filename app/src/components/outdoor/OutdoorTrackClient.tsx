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

function stepIndex(status: string) {
  const s = status.toLowerCase()
  if (s.includes('deliver')) return 3
  if (s.includes('ship') || s.includes('fulfil') || s.includes('fulfill')) return 2
  if (s.includes('paid') || s.includes('confirm') || s.includes('process')) return 1
  return 0
}

const STEPS = ['Placed', 'Paid', 'Shipped', 'Delivered']

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

  const activeStep = order ? stepIndex(order.status) : -1

  return (
    <div className="mx-auto max-w-lg px-4 sm:px-6 py-10 sm:py-14">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--out-bark)]/50">
        SeraOutdoor
      </p>
      <h1 className="mt-2 text-center font-display text-4xl tracking-tight text-[var(--out-bark)]">Track order</h1>
      <p className="mt-2 text-center text-sm text-[var(--out-muted)]">
        Use the order number from your confirmation email.
      </p>

      <form className="out-card mt-8 space-y-4 p-5 sm:p-7" onSubmit={submit}>
        <label className="block text-sm font-medium text-[var(--out-bark)]">
          Order number
          <input
            required
            value={orderRef}
            onChange={(e) => setOrderRef(e.target.value)}
            placeholder="ORD-…"
            className="out-input"
          />
        </label>
        <label className="block text-sm font-medium text-[var(--out-bark)]">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="out-input"
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button type="submit" disabled={loading} className="out-btn w-full">
          {loading ? 'Searching…' : 'Find my order'}
        </button>
      </form>

      {order ? (
        <div className="out-card mt-5 space-y-6 p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--out-muted)]">Order</p>
              <p className="mt-1 font-mono text-lg font-semibold text-[var(--out-bark)]">{order.orderRef}</p>
            </div>
            <span className="rounded-full bg-[var(--out-bark)] px-3 py-1 text-xs font-semibold uppercase text-[var(--out-cream)]">
              {statusLabel(order.status)}
            </span>
          </div>

          <ol className="grid grid-cols-4 gap-2">
            {STEPS.map((label, i) => {
              const done = i <= activeStep
              return (
                <li key={label} className="text-center">
                  <span className={`mx-auto block h-2 w-full rounded-full ${done ? 'bg-[var(--out-moss)]' : 'bg-[var(--out-bark)]/10'}`} />
                  <span className={`mt-2 block text-[10px] font-semibold uppercase tracking-wide ${done ? 'text-[var(--out-bark)]' : 'text-[var(--out-muted)]'}`}>
                    {label}
                  </span>
                </li>
              )
            })}
          </ol>

          <div className="grid gap-2 text-sm text-[var(--out-bark)]">
            <p><span className="text-[var(--out-muted)]">Placed</span> · {new Date(order.createdAt).toLocaleString()}</p>
            <p><span className="text-[var(--out-muted)]">Total</span> · {money(order.totalAmount, order.currency)}</p>
            {order.shippingCourierName ? (
              <p><span className="text-[var(--out-muted)]">Courier</span> · {order.shippingCourierName}</p>
            ) : null}
            {order.shippingTrackingNo ? (
              <p><span className="text-[var(--out-muted)]">Tracking</span> · <span className="font-mono">{order.shippingTrackingNo}</span></p>
            ) : null}
            {order.courierLatestStatus ? (
              <p><span className="text-[var(--out-muted)]">Update</span> · {order.courierLatestStatus}</p>
            ) : null}
          </div>

          <ul className="space-y-2 border-t border-[var(--out-bark)]/10 pt-4 text-sm">
            {order.items.map((item, i) => (
              <li key={`${item.productName}-${i}`} className="flex justify-between gap-3 text-[var(--out-bark)]">
                <span>{item.productName} × {item.quantity}</span>
                <span className="font-medium">{money(item.subtotal, order.currency)}</span>
              </li>
            ))}
          </ul>

          {order.courierEvents && order.courierEvents.length > 0 ? (
            <ul className="space-y-3 border-t border-[var(--out-bark)]/10 pt-4">
              {order.courierEvents.map((ev, i) => (
                <li key={`${ev.status}-${i}`} className="text-sm">
                  <p className="font-medium text-[var(--out-bark)]">{ev.status}{ev.location ? ` · ${ev.location}` : ''}</p>
                  <p className="text-xs text-[var(--out-muted)]">{ev.date || ''}</p>
                </li>
              ))}
            </ul>
          ) : !order.shippingTrackingNo ? (
            <p className="text-xs text-[var(--out-muted)]">
              Courier updates appear here after we ship.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
