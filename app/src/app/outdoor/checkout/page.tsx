'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Truck } from 'lucide-react'
import { useCart } from '@/lib/storefront/cart-context'
import { createClient } from '@/lib/supabase/client'
import { MALAYSIA_STATES } from '@/lib/shipping/malaysia-states'
import { socialAccountLabel } from '@/lib/auth/social-oauth'
import { OUTDOOR_FREE_SHIPPING_OVER_RM, outdoorCustomerShippingAmount } from '@/lib/outdoor/shipping'

const LOGIN_FOR_CHECKOUT = `/outdoor/login?next=${encodeURIComponent('/outdoor/checkout')}`

function money(n: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n)
}

export default function OutdoorCheckoutPage() {
  const router = useRouter()
  const { items, subtotal, clearCart, hasItemsWithoutPrice } = useCart()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [payMethods, setPayMethods] = useState<{ key: string; label: string; isDefault: boolean }[]>([])
  const [payProvider, setPayProvider] = useState('')
  const [accountEmail, setAccountEmail] = useState('')
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

  useEffect(() => {
    const supabase = createClient()
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user?.email) {
        router.replace(LOGIN_FOR_CHECKOUT)
        return
      }
      setAccountEmail(user.email)
      const username = typeof user.user_metadata?.username === 'string' ? user.user_metadata.username : ''
      setForm((current) => ({
        ...current,
        email: socialAccountLabel(user.email || '', username),
      }))
    })
  }, [router])

  useEffect(() => {
    void fetch('/api/storefront/payment/methods')
      .then((res) => res.json())
      .then((data) => {
        const methods = Array.isArray(data?.methods) ? data.methods : []
        setPayMethods(methods)
        const def = methods.find((m: { isDefault: boolean }) => m.isDefault) || methods[0]
        if (def?.key) setPayProvider(def.key)
      })
      .catch(() => {
        setPayMethods([])
      })
  }, [])

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

  const shippingCost = outdoorCustomerShippingAmount(subtotal)
  const freeShipping = shippingCost <= 0
  const total = subtotal + shippingCost

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (hasItemsWithoutPrice) {
      setError('Remove items without a valid price before paying.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/storefront/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: { ...form, email: accountEmail || form.email },
          items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
          returnBasePath: '/outdoor',
          salesChannel: 'outdoor',
          paymentProvider: payProvider || undefined,
          shipping: { amount: shippingCost },
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Checkout failed')
      clearCart()
      if (data?.paymentUrl) {
        sessionStorage.setItem('outdoor-pay-next', data.paymentUrl)
        window.location.replace(`/outdoor/pay?ref=${encodeURIComponent(data.orderRef || '')}`)
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
        {freeShipping
          ? 'Where should we send your gear? Shipping is free.'
          : `Where should we send your gear? Delivery is a flat ${money(shippingCost)}.`}
      </p>

      <div className="mt-8 grid gap-5 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        <form className="out-card space-y-5 p-5 sm:p-7" onSubmit={submit}>
          <div>
            <h2 className="font-display text-xl text-[var(--out-bark)]">Your details</h2>
            <div className="mt-4 space-y-3">
              {field('name', 'Full name')}
              <label className="block text-sm font-medium text-[var(--out-bark)]">
                Account
                <input readOnly value={form.email} className="out-input bg-[var(--out-sand)]/40" />
              </label>
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
            <h2 className="font-display text-xl text-[var(--out-bark)]">Shipping</h2>
            <div className="mt-4 overflow-hidden rounded-[1.4rem] border border-[var(--out-bark)]/10 bg-[var(--out-ivory)]">
              <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--out-bark)] text-[var(--out-cream)]">
                  <Truck className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-xl leading-none text-[var(--out-bark)]">
                    {freeShipping ? 'Free shipping' : 'Standard delivery'}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--out-muted)]">
                    {freeShipping
                      ? 'We cover delivery anywhere in Malaysia.'
                      : 'One rate for every address in Malaysia. We arrange the courier.'}
                  </p>
                </div>
                <p className="shrink-0 whitespace-nowrap font-display text-xl text-[var(--out-bark)] sm:text-2xl">
                  {freeShipping ? 'Free' : money(shippingCost)}
                </p>
              </div>
              {OUTDOOR_FREE_SHIPPING_OVER_RM != null && OUTDOOR_FREE_SHIPPING_OVER_RM > 0 ? (
                <p className="border-t border-[var(--out-bark)]/10 px-4 py-2.5 text-xs text-[var(--out-bark)] sm:px-5">
                  {freeShipping
                    ? 'Free shipping is included on this order.'
                    : `Free shipping on orders from ${money(OUTDOOR_FREE_SHIPPING_OVER_RM)}.`}
                </p>
              ) : null}
            </div>
          </div>

          {payMethods.length > 1 ? (
            <div>
              <h2 className="font-display text-xl text-[var(--out-bark)]">Pay with</h2>
              <div className="mt-4 space-y-2">
                {payMethods.map((m) => {
                  const active = payProvider === m.key
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setPayProvider(m.key)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${
                        active
                          ? 'border-[var(--out-bark)] bg-[var(--out-ivory)]'
                          : 'border-[var(--out-bark)]/10 hover:border-[var(--out-bark)]/30'
                      }`}
                    >
                      <span className="font-semibold text-[var(--out-bark)]">{m.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

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
              <span>{freeShipping ? 'Free' : money(shippingCost)}</span>
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
