'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCart } from '@/lib/storefront/cart-context'
import { createClient } from '@/lib/supabase/client'
import { MALAYSIA_STATES } from '@/lib/shipping/malaysia-states'

const LOGIN_FOR_CHECKOUT = `/outdoor/login?next=${encodeURIComponent('/outdoor/checkout')}`

type Rate = {
  serviceId: string
  courierName: string
  serviceName: string
  price: number
  delivery: string | null
}

function money(n: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n)
}

export default function OutdoorCheckoutPage() {
  const router = useRouter()
  const { items, subtotal, clearCart, hasItemsWithoutPrice } = useCart()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rates, setRates] = useState<Rate[]>([])
  const [ratesMsg, setRatesMsg] = useState('Add your postcode to see courier options.')
  const [ratesLoading, setRatesLoading] = useState(false)
  const [selectedRate, setSelectedRate] = useState<Rate | null>(null)
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: 'Selangor',
    postcode: '',
  })

  const loadRates = useCallback(async () => {
    if (!form.postcode.trim() || !form.state.trim()) return
    setRatesLoading(true)
    setRatesMsg('')
    setSelectedRate(null)
    try {
      const res = await fetch('/api/shipping/easyparcel/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcode: form.postcode, state: form.state }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setRates([])
        setRatesMsg(data?.error || 'Could not load shipping rates.')
        return
      }
      const list: Rate[] = data?.rates || []
      setRates(list)
      if (!data?.configured) {
        setRatesMsg(data?.message || 'Shipping rates are not available yet. You can still checkout — shipping may be RM 0 until courier is connected.')
      } else if (list.length === 0) {
        setRatesMsg(data?.error || 'No rates for this address. Try another postcode.')
      } else {
        setSelectedRate(list[0])
        setRatesMsg('')
      }
    } catch {
      setRates([])
      setRatesMsg('Could not load shipping rates.')
    } finally {
      setRatesLoading(false)
    }
  }, [form.postcode, form.state])

  useEffect(() => {
    if (form.postcode.trim().length >= 5 && form.state) {
      const t = setTimeout(() => void loadRates(), 450)
      return () => clearTimeout(t)
    }
  }, [form.postcode, form.state, loadRates])

  useEffect(() => {
    const supabase = createClient()
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.replace(LOGIN_FOR_CHECKOUT)
    })
  }, [router])

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <div className="out-card px-6 py-12">
          <h1 className="font-display text-3xl tracking-tight text-[var(--out-bark)]">Your bag is empty</h1>
          <p className="mt-3 text-sm text-[var(--out-muted)]">Add a chair, mat, or tumbler first.</p>
          <Link href="/outdoor/shop" className="out-btn mt-8 w-full">
            Shop Outdoor
          </Link>
        </div>
      </div>
    )
  }

  const shippingCost = selectedRate?.price ?? 0
  const total = subtotal + shippingCost

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (hasItemsWithoutPrice) {
      setError('Remove items without a valid price before paying.')
      return
    }
    if (rates.length > 0 && !selectedRate) {
      setError('Select a shipping option.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/storefront/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: form,
          items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
          returnBasePath: '/outdoor',
          salesChannel: 'outdoor',
          shipping: selectedRate
            ? {
                serviceId: selectedRate.serviceId,
                courierName: `${selectedRate.courierName} — ${selectedRate.serviceName}`,
                amount: selectedRate.price,
              }
            : { amount: 0 },
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Checkout failed')
      clearCart()
      if (data?.paymentUrl) {
        window.location.href = data.paymentUrl
        return
      }
      router.push(`/outdoor/orders/success?ref=${encodeURIComponent(data.orderRef || '')}`)
    } catch (err: any) {
      setError(err.message || 'Checkout failed')
    } finally {
      setLoading(false)
    }
  }

  const field = (key: keyof typeof form, label: string, opts?: { required?: boolean; type?: string }) => (
    <label className="block text-sm font-medium text-[var(--out-bark)]">
      {label}
      <input
        required={opts?.required !== false}
        type={opts?.type || 'text'}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="out-input"
      />
    </label>
  )

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-8 py-8 sm:py-12">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--out-bark)]/50">
        Delivery · Shipping · Pay
      </p>
      <h1 className="mt-2 text-center font-display text-4xl tracking-tight text-[var(--out-bark)]">Checkout</h1>
      <p className="mx-auto mt-2 max-w-md text-center text-sm text-[var(--out-muted)]">
        Where should we send your gear? Then pick a courier and pay securely.
      </p>

      <div className="mt-8 grid gap-5 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        <form className="out-card space-y-5 p-5 sm:p-7" onSubmit={submit}>
          <div>
            <h2 className="font-display text-xl text-[var(--out-bark)]">Your details</h2>
            <div className="mt-4 space-y-3">
              {field('name', 'Full name')}
              {field('email', 'Email', { type: 'email' })}
              {field('phone', 'Phone', { type: 'tel' })}
            </div>
          </div>

          <div>
            <h2 className="font-display text-xl text-[var(--out-bark)]">Delivery address</h2>
            <div className="mt-4 space-y-3">
              {field('addressLine1', 'Address line 1')}
              {field('addressLine2', 'Address line 2', { required: false })}
              <div className="grid gap-3 sm:grid-cols-3">
                {field('city', 'City')}
                <label className="block text-sm font-medium text-[var(--out-bark)]">
                  State
                  <select
                    required
                    value={form.state}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                    className="out-input"
                  >
                    {MALAYSIA_STATES.map((s) => (
                      <option key={s.code} value={s.label}>{s.label}</option>
                    ))}
                  </select>
                </label>
                {field('postcode', 'Postcode')}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl text-[var(--out-bark)]">Shipping</h2>
              <button
                type="button"
                onClick={() => void loadRates()}
                disabled={ratesLoading || !form.postcode}
                className="text-xs font-semibold text-[var(--out-moss)] disabled:opacity-40"
              >
                {ratesLoading ? 'Loading…' : 'Refresh rates'}
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {rates.length > 0 ? (
                rates.map((r) => {
                  const active = selectedRate?.serviceId === r.serviceId
                  return (
                    <button
                      key={r.serviceId}
                      type="button"
                      onClick={() => setSelectedRate(r)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${
                        active
                          ? 'border-[var(--out-bark)] bg-[var(--out-ivory)]'
                          : 'border-[var(--out-bark)]/10 hover:border-[var(--out-bark)]/30'
                      }`}
                    >
                      <div className="flex justify-between gap-3 text-[var(--out-bark)]">
                        <span className="font-semibold">{r.courierName}</span>
                        <span className="font-semibold">{money(r.price)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--out-muted)]">
                        {r.serviceName}
                        {r.delivery ? ` · ${r.delivery}` : ''}
                      </p>
                    </button>
                  )
                })
              ) : (
                <p className="rounded-2xl bg-[var(--out-ivory)] px-4 py-3 text-xs text-[var(--out-muted)]">{ratesMsg}</p>
              )}
            </div>
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button type="submit" disabled={loading} className="out-btn w-full">
            {loading ? 'Processing…' : `Pay ${money(total)}`}
          </button>
        </form>

        <aside className="out-card p-5 sm:p-6 lg:sticky lg:top-24">
          <h2 className="font-display text-xl text-[var(--out-bark)]">Your bag</h2>
          <ul className="mt-4 space-y-3">
            {items.map((i) => (
              <li key={i.variantId} className="flex items-center gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-[var(--out-ivory)]">
                  {i.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.imageUrl} alt="" className="h-full w-full object-contain p-1" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--out-bark)]">{i.productName}</p>
                  <p className="text-xs text-[var(--out-muted)]">× {i.quantity}</p>
                </div>
                <span className="text-sm font-medium text-[var(--out-bark)]">
                  {i.price != null ? money(i.price * i.quantity) : '—'}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-5 space-y-2 border-t border-[var(--out-bark)]/10 pt-4 text-sm text-[var(--out-bark)]">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Shipping</span>
              <span>{selectedRate ? money(shippingCost) : '—'}</span>
            </div>
            <div className="flex justify-between pt-2 font-display text-xl">
              <span>Total</span>
              <span>{money(total)}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
