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
  const [ratesMsg, setRatesMsg] = useState('Enter postcode and state to load courier rates.')
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
      <div className="mx-auto max-w-3xl px-5 py-16 text-center">
        <h1 className="font-display text-4xl">Checkout</h1>
        <p className="mt-4 text-[var(--out-muted)]">Your cart is empty.</p>
        <Link href="/outdoor/shop" className="mt-6 inline-block text-[var(--out-moss)] font-semibold">Go to shop</Link>
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
    <label className="block text-sm">
      <span className="text-[var(--out-ink-soft)]">{label}</span>
      <input
        required={opts?.required !== false}
        type={opts?.type || 'text'}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] bg-white px-3"
      />
    </label>
  )

  return (
    <div className="mx-auto max-w-5xl px-5 sm:px-8 py-12 sm:py-16 grid lg:grid-cols-[1.2fr_0.8fr] gap-10">
      <div>
        <h1 className="font-display text-4xl tracking-tight">Checkout</h1>
        <p className="mt-2 text-sm text-[var(--out-muted)]">
          Enter your delivery details, pick shipping, then pay.
        </p>
        <form className="mt-8 space-y-4" onSubmit={submit}>
          {field('name', 'Full name')}
          {field('email', 'Email', { type: 'email' })}
          {field('phone', 'Phone', { type: 'tel' })}
          {field('addressLine1', 'Address line 1')}
          {field('addressLine2', 'Address line 2', { required: false })}
          <div className="grid sm:grid-cols-3 gap-4">
            {field('city', 'City')}
            <label className="block text-sm">
              <span className="text-[var(--out-ink-soft)]">State</span>
              <select
                required
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                className="mt-1.5 h-11 w-full rounded-md border border-[var(--out-line)] bg-white px-3"
              >
                {MALAYSIA_STATES.map((s) => (
                  <option key={s.code} value={s.label}>{s.label}</option>
                ))}
              </select>
            </label>
            {field('postcode', 'Postcode')}
          </div>

          <div className="rounded-md border border-[var(--out-line)] bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Shipping</p>
              <button
                type="button"
                onClick={() => void loadRates()}
                disabled={ratesLoading || !form.postcode}
                className="text-xs font-medium text-[var(--out-moss)] disabled:opacity-40"
              >
                {ratesLoading ? 'Loading…' : 'Refresh rates'}
              </button>
            </div>
            {rates.length > 0 ? (
              <ul className="space-y-2">
                {rates.map((r) => {
                  const active = selectedRate?.serviceId === r.serviceId
                  return (
                    <li key={r.serviceId}>
                      <button
                        type="button"
                        onClick={() => setSelectedRate(r)}
                        className={`w-full text-left rounded-md border px-3 py-2.5 text-sm transition-colors ${
                          active
                            ? 'border-[var(--out-moss)] bg-[var(--out-moss)]/5'
                            : 'border-[var(--out-line)] hover:border-[var(--out-moss)]/50'
                        }`}
                      >
                        <div className="flex justify-between gap-3">
                          <span className="font-medium">{r.courierName}</span>
                          <span className="font-semibold">{money(r.price)}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--out-muted)]">
                          {r.serviceName}
                          {r.delivery ? ` · ${r.delivery}` : ''}
                        </p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-xs text-[var(--out-muted)]">{ratesMsg}</p>
            )}
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="h-12 w-full rounded-md bg-[var(--out-moss)] text-sm font-semibold text-white hover:bg-[var(--out-moss-deep)] disabled:opacity-50"
          >
            {loading ? 'Processing…' : `Pay ${money(total)}`}
          </button>
        </form>
      </div>
      <aside className="rounded-xl border border-[var(--out-line)] bg-white p-5 h-fit">
        <h2 className="font-display text-xl">Order summary</h2>
        <ul className="mt-4 space-y-3 text-sm">
          {items.map((i) => (
            <li key={i.variantId} className="flex justify-between gap-3">
              <span className="text-[var(--out-muted)]">{i.productName} × {i.quantity}</span>
              <span className="font-medium">{i.price != null ? money(i.price * i.quantity) : '—'}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 pt-4 border-t border-[var(--out-line)] space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{money(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Shipping</span>
            <span>{selectedRate ? money(shippingCost) : '—'}</span>
          </div>
          <div className="flex justify-between font-semibold text-base pt-2">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
        </div>
      </aside>
    </div>
  )
}
