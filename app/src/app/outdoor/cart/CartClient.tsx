'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useCart } from '@/lib/storefront/cart-context'
import { createClient } from '@/lib/supabase/client'

function money(n: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(n)
}

const LOGIN_FOR_CHECKOUT = `/outdoor/login?next=${encodeURIComponent('/outdoor/checkout')}`

export default function OutdoorCartClient() {
  const router = useRouter()
  const { items, updateQuantity, removeItem, subtotal, hasItemsWithoutPrice } = useCart()
  const [checkingOut, setCheckingOut] = useState(false)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    void supabase.auth.getUser().then(({ data: { user } }) => setSignedIn(Boolean(user)))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(Boolean(session?.user))
    })
    return () => subscription.unsubscribe()
  }, [])

  const goCheckout = async () => {
    setCheckingOut(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push(LOGIN_FOR_CHECKOUT)
      return
    }
    router.push('/outdoor/checkout')
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-5 sm:px-8 py-16 text-center">
        <h1 className="font-display text-4xl tracking-tight">Shopping cart</h1>
        <p className="mt-4 text-[var(--out-muted)]">Your cart is empty.</p>
        <Link href="/outdoor/shop" className="mt-8 inline-flex h-11 items-center rounded-md bg-[var(--out-moss)] px-5 text-sm font-semibold text-white">
          Continue shopping
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-5 sm:px-8 py-12 sm:py-16">
      <h1 className="font-display text-4xl tracking-tight">Shopping cart</h1>
      <ul className="mt-8 space-y-4">
        {items.map((item) => (
          <li key={item.variantId} className="flex gap-4 rounded-xl border border-[var(--out-line)] bg-white p-4">
            <div className="h-24 w-24 rounded-lg overflow-hidden bg-[var(--out-sand)]/40 shrink-0">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display text-lg truncate">{item.productName}</p>
              <p className="text-sm text-[var(--out-muted)]">{item.variantName}</p>
              <p className="mt-1 text-sm font-semibold">{item.price != null ? money(item.price) : '—'}</p>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => updateQuantity(item.variantId, Number(e.target.value) || 1)}
                  className="w-16 h-9 rounded-md border border-[var(--out-line)] px-2 text-sm"
                />
                <button type="button" onClick={() => removeItem(item.variantId)} className="text-sm text-red-600">
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-8 rounded-xl border border-[var(--out-line)] bg-white p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-sm text-[var(--out-muted)]">Subtotal</p>
          <p className="text-2xl font-semibold text-[var(--out-moss-deep)]">{money(subtotal)}</p>
          {hasItemsWithoutPrice ? (
            <p className="mt-1 text-xs text-amber-700">Some items need a valid price before checkout.</p>
          ) : !signedIn ? (
            <p className="mt-1 text-xs text-[var(--out-muted)]">You’ll sign in to place the order.</p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={checkingOut || hasItemsWithoutPrice}
          onClick={() => void goCheckout()}
          className="inline-flex h-12 items-center justify-center rounded-md bg-[var(--out-moss)] px-6 text-sm font-semibold text-white disabled:opacity-50"
        >
          {checkingOut ? 'Please wait…' : signedIn ? 'Checkout' : 'Sign in to checkout'}
        </button>
      </div>
    </div>
  )
}
