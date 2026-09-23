'use client'

import { useEffect, useState } from 'react'
import { resumeOutdoorPayment } from '@/lib/outdoor/resume-payment'

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

type MineOrder = {
  orderRef: string
  status: string
  createdAt: string
  preview: string[]
}

function orderOptionLabel(item: MineOrder) {
  const when = item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) : ''
  const name = item.preview.filter(Boolean).join(', ')
  return [item.orderRef, name, statusLabel(item.status), when].filter(Boolean).join(' · ')
}

export default function OutdoorTrackClient({ initialOrderRef = '' }: { initialOrderRef?: string }) {
  const directRef = initialOrderRef.trim()
  const [orderRef, setOrderRef] = useState(directRef)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(Boolean(directRef))
  const [error, setError] = useState('')
  const [order, setOrder] = useState<TrackedOrder | null>(null)
  const [paying, setPaying] = useState(false)
  const [showForm, setShowForm] = useState(!directRef)
  const [accountMode, setAccountMode] = useState<'loading' | 'guest' | 'in'>('loading')
  const [accountOrders, setAccountOrders] = useState<MineOrder[]>([])

  const lookup = async (ref: string, mail: string) => {
    setLoading(true)
    setError('')
    setOrder(null)
    try {
      const res = await fetch('/api/storefront/orders/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderRef: ref, email: mail }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Lookup failed')
      setOrder(data.order)
      setShowForm(false)
    } catch (err: any) {
      setShowForm(true)
      setError(err.message || 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void fetch('/api/storefront/orders/mine?channel=outdoor')
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          setAccountMode('guest')
          return
        }
        const data = await res.json().catch(() => null)
        if (cancelled) return
        setAccountOrders(data?.orders || [])
        setAccountMode('in')
      })
      .catch(() => {
        if (!cancelled) setAccountMode('guest')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!directRef) return
    const mail = new URLSearchParams(window.location.search).get('email')?.trim() || ''
    if (mail) setEmail(mail)
    void lookup(directRef, mail)
    // Load the order from the account link once. The signed-in email is already known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directRef])

  const signedIn = accountMode === 'in'
  const waitingForAccount = accountMode === 'loading' && !directRef

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    await lookup(orderRef, email)
  }

  const activeStep = order ? stepIndex(order.status) : -1

  return (
    <div className="mx-auto max-w-lg px-4 sm:px-6 py-10 sm:py-14">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--out-bark)]/50">
        SeraOutdoor
      </p>
      <h1 className="mt-2 text-center font-display text-4xl tracking-tight text-[var(--out-bark)]">Track order</h1>
      {showForm && !signedIn ? (
        <p className="mt-2 text-center text-sm text-[var(--out-muted)]">
          {waitingForAccount ? 'Loading your orders…' : 'Use the order number from your confirmation email.'}
        </p>
      ) : null}

      {signedIn ? (
        <form className="out-card mt-8 space-y-4 p-5 sm:p-7" onSubmit={(event) => event.preventDefault()}>
          {accountOrders.length === 0 ? (
            <p className="text-sm text-[var(--out-muted)]">You do not have an order yet.</p>
          ) : (
          <>
          <label className="block text-sm font-medium text-[var(--out-bark)]">
            Your order
            <select
              required
              value={orderRef}
              onChange={(event) => {
                const next = event.target.value
                setOrderRef(next)
                if (next) void lookup(next, '')
              }}
              className="out-input"
            >
              <option value="">Choose an order</option>
              {accountOrders.map((item) => (
                <option key={item.orderRef} value={item.orderRef}>
                  {orderOptionLabel(item)}
                </option>
              ))}
            </select>
          </label>
          {error && !order ? <p className="text-sm text-red-600">{error}</p> : null}
          </>
          )}
        </form>
      ) : null}

      {showForm && !signedIn && !waitingForAccount ? (
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
      ) : loading ? (
        <p className="mt-8 text-center text-sm text-[var(--out-muted)]">Loading this order…</p>
      ) : null}

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

          {order.status === 'pending_payment' ? (
            <button
              type="button"
              disabled={paying}
              onClick={() => {
                setPaying(true)
                setError('')
                void resumeOutdoorPayment(order.orderRef).catch((err: any) => {
                  setPaying(false)
                  setError(err.message || 'Could not continue payment')
                })
              }}
              className="inline-flex h-12 w-full items-center justify-center rounded-full bg-[var(--out-moss)] text-sm font-semibold text-white hover:bg-[var(--out-moss-deep)] disabled:opacity-40"
            >
              {paying ? 'Opening payment…' : 'Continue payment'}
            </button>
          ) : null}
          {error && order ? <p className="text-sm text-red-600">{error}</p> : null}

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
          {signedIn ? null : (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="text-xs font-semibold text-[var(--out-moss)] hover:underline"
          >
            Track a different order
          </button>
          )}
        </div>
      ) : null}
    </div>
  )
}
