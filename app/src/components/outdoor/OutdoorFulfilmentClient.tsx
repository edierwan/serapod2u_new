'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type OrderItem = {
  id: string
  product_name: string
  variant_name: string
  quantity: number
  unit_price: number
  subtotal: number
}

type Order = {
  id: string
  order_ref: string
  status: string
  customer_name: string
  customer_email: string
  customer_phone: string
  shipping_address: {
    line1?: string
    line2?: string
    city?: string
    state?: string
    postcode?: string
  }
  total_amount: number
  shipping_amount?: number
  shipping_courier_name?: string | null
  shipping_service_id?: string | null
  shipping_tracking_no?: string | null
  easyparcel_order_no?: string | null
  paid_at?: string | null
  created_at: string
  storefront_order_items?: OrderItem[]
}

type ContactMessage = {
  id: string
  name: string
  email: string
  message: string
  status: string
  created_at: string
}

function money(n: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n)
}

export default function OutdoorFulfilmentClient() {
  const router = useRouter()
  const [tab, setTab] = useState<'orders' | 'inbox'>('orders')
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [messages, setMessages] = useState<ContactMessage[]>([])
  const [easyParcelConfigured, setEasyParcelConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [trackingDraft, setTrackingDraft] = useState<Record<string, string>>({})

  const loadOrders = useCallback(async () => {
    const params = new URLSearchParams({ status: 'fulfilment' })
    if (search.trim()) params.set('search', search.trim())
    const res = await fetch(`/api/outdoor/fulfilment?${params}`)
    const data = await res.json().catch(() => null)
    if (res.status === 401) {
      setAllowed(false)
      return
    }
    if (!res.ok) throw new Error(data?.error || 'Failed to load orders')
    setOrders(data.orders || [])
    setEasyParcelConfigured(Boolean(data.easyParcelConfigured))
  }, [search])

  const loadInbox = useCallback(async () => {
    const res = await fetch('/api/outdoor/contact?limit=40')
    const data = await res.json().catch(() => null)
    if (res.status === 401) {
      setAllowed(false)
      return
    }
    if (!res.ok) throw new Error(data?.error || 'Failed to load inbox')
    setMessages(data.messages || [])
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const access = await fetch('/api/outdoor/fulfilment/access')
      const accessData = await access.json().catch(() => null)
      if (!accessData?.allowed) {
        setAllowed(false)
        return
      }
      setAllowed(true)
      if (tab === 'orders') await loadOrders()
      else await loadInbox()
    } catch (err: any) {
      setError(err.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [tab, loadOrders, loadInbox])

  useEffect(() => {
    void load()
  }, [load])

  const runAction = async (id: string, action: string, extra?: Record<string, string>) => {
    setBusyId(id)
    setError('')
    try {
      const res = await fetch('/api/outdoor/fulfilment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, ...extra }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Update failed')
      await loadOrders()
    } catch (err: any) {
      setError(err.message || 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  if (allowed === false) {
    return (
      <div className="mx-auto max-w-lg px-5 py-20 text-center">
        <h1 className="font-display text-3xl">Staff only</h1>
        <p className="mt-3 text-sm text-[var(--out-muted)]">
          This page is for warehouse and HQ staff — not for shoppers.
        </p>
        <Link href={`/login?next=${encodeURIComponent('/outdoor/fulfilment')}`} className="mt-6 inline-block text-[var(--out-moss)] font-semibold">
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-5 sm:px-8 py-12 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Staff desk</h1>
          <p className="mt-2 text-sm text-[var(--out-muted)]">
            Outdoor fulfilment + contact inbox. Does not change `/store`.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="h-10 px-4 rounded-md border border-[var(--out-line)] text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      <div className="mt-6 flex gap-2 border-b border-[var(--out-line)]">
        <button
          type="button"
          onClick={() => setTab('orders')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
            tab === 'orders' ? 'border-[var(--out-moss)]' : 'border-transparent text-[var(--out-muted)]'
          }`}
        >
          Fulfilment
        </button>
        <button
          type="button"
          onClick={() => setTab('inbox')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${
            tab === 'inbox' ? 'border-[var(--out-moss)]' : 'border-transparent text-[var(--out-muted)]'
          }`}
        >
          Contact inbox
        </button>
      </div>

      {tab === 'orders' ? (
        <div className="mt-6 flex flex-wrap gap-3 items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ref, name, email, tracking…"
            className="h-11 flex-1 min-w-[220px] rounded-md border border-[var(--out-line)] bg-white px-3 text-sm"
          />
          <p className="text-xs text-[var(--out-muted)]">
            EasyParcel: {easyParcelConfigured ? 'connected' : 'not configured (manual tracking OK)'}
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {loading ? (
        <p className="mt-10 text-sm text-[var(--out-muted)]">Loading…</p>
      ) : tab === 'inbox' ? (
        messages.length === 0 ? (
          <p className="mt-10 text-sm text-[var(--out-muted)]">No contact messages yet.</p>
        ) : (
          <ul className="mt-8 space-y-4">
            {messages.map((m) => (
              <li key={m.id} className="rounded-xl border border-[var(--out-line)] bg-white p-5">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-semibold">{m.name}</p>
                  <p className="text-xs text-[var(--out-muted)]">{new Date(m.created_at).toLocaleString()}</p>
                </div>
                <a href={`mailto:${m.email}`} className="text-sm text-[var(--out-moss)] hover:underline">
                  {m.email}
                </a>
                <p className="mt-3 text-sm text-[var(--out-ink-soft)] whitespace-pre-wrap">{m.message}</p>
              </li>
            ))}
          </ul>
        )
      ) : orders.length === 0 ? (
        <p className="mt-10 text-sm text-[var(--out-muted)]">No Outdoor fulfilment orders yet.</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {orders.map((o) => {
            const addr = o.shipping_address || {}
            const busy = busyId === o.id
            return (
              <li key={o.id} className="rounded-xl border border-[var(--out-line)] bg-white p-5">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <p className="font-semibold">{o.order_ref}</p>
                    <p className="text-xs uppercase tracking-wide text-[var(--out-muted)] mt-1">{o.status}</p>
                  </div>
                  <p className="font-semibold">{money(Number(o.total_amount) || 0)}</p>
                </div>
                <p className="mt-3 text-sm">
                  {o.customer_name} · {o.customer_phone} · {o.customer_email}
                </p>
                <p className="mt-1 text-sm text-[var(--out-muted)]">
                  {[addr.line1, addr.line2, addr.city, addr.state, addr.postcode].filter(Boolean).join(', ')}
                </p>
                {o.shipping_courier_name ? (
                  <p className="mt-1 text-xs text-[var(--out-muted)]">Courier quote: {o.shipping_courier_name}</p>
                ) : null}
                {o.shipping_tracking_no ? (
                  <p className="mt-1 text-sm font-medium">Tracking: {o.shipping_tracking_no}</p>
                ) : null}
                <ul className="mt-3 text-sm text-[var(--out-muted)] space-y-1">
                  {(o.storefront_order_items || []).map((i) => (
                    <li key={i.id}>
                      {i.product_name} ({i.variant_name}) × {i.quantity}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  {o.status === 'paid' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runAction(o.id, 'mark_processing')}
                      className="h-9 px-3 rounded-md bg-[var(--out-moss)] text-white text-xs font-semibold disabled:opacity-50"
                    >
                      Mark packing
                    </button>
                  ) : null}
                  {['paid', 'processing'].includes(o.status) && o.shipping_service_id && easyParcelConfigured ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runAction(o.id, 'ship_easyparcel')}
                      className="h-9 px-3 rounded-md border border-[var(--out-line)] text-xs font-semibold disabled:opacity-50"
                    >
                      Ship via EasyParcel
                    </button>
                  ) : null}
                  {['paid', 'processing'].includes(o.status) ? (
                    <div className="flex flex-wrap gap-2 items-center">
                      <input
                        value={trackingDraft[o.id] || ''}
                        onChange={(e) => setTrackingDraft((d) => ({ ...d, [o.id]: e.target.value }))}
                        placeholder="Manual tracking no."
                        className="h-9 rounded-md border border-[var(--out-line)] px-2 text-xs"
                      />
                      <button
                        type="button"
                        disabled={busy || !trackingDraft[o.id]?.trim()}
                        onClick={() =>
                          void runAction(o.id, 'set_tracking', { trackingNo: trackingDraft[o.id] || '' })
                        }
                        className="h-9 px-3 rounded-md border border-[var(--out-line)] text-xs font-semibold disabled:opacity-50"
                      >
                        Mark shipped
                      </button>
                    </div>
                  ) : null}
                  {o.status === 'shipped' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void runAction(o.id, 'mark_delivered')}
                      className="h-9 px-3 rounded-md border border-[var(--out-line)] text-xs font-semibold disabled:opacity-50"
                    >
                      Mark delivered
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-10 text-xs text-[var(--out-muted)]">
        <button type="button" className="underline" onClick={() => router.push('/outdoor')}>
          Back to Outdoor
        </button>
      </p>
    </div>
  )
}
