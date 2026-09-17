'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
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
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <div className="out-card px-6 py-12">
          <h1 className="font-display text-3xl tracking-tight text-[var(--out-bark)]">Your bag is empty</h1>
          <p className="mt-3 text-sm text-[var(--out-muted)]">Moon Chair, tumbler, and camp mat live in the shop.</p>
          <Link href="/outdoor/shop" className="out-btn mt-8 w-full">
            Shop Outdoor
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-8 py-8 sm:py-12">
      <h1 className="text-center font-display text-4xl tracking-tight text-[var(--out-bark)]">Your bag</h1>
      <ul className="mt-8 space-y-3">
        {items.map((item) => (
          <li key={item.variantId} className="out-card flex gap-4 p-4">
            <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-[var(--out-ivory)]">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt="" className="h-full w-full object-contain p-1.5" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg text-[var(--out-bark)]">{item.productName}</p>
              <p className="text-sm text-[var(--out-muted)]">{item.variantName}</p>
              <p className="mt-1 text-sm font-semibold text-[var(--out-bark)]">
                {item.price != null ? money(item.price) : '—'}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="inline-flex h-10 items-center rounded-full bg-[var(--out-ivory)] px-1 text-[var(--out-bark)]">
                  <button
                    type="button"
                    className="p-2"
                    aria-label="Decrease"
                    onClick={() => updateQuantity(item.variantId, Math.max(1, item.quantity - 1))}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                  <button
                    type="button"
                    className="p-2"
                    aria-label="Increase"
                    onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button type="button" onClick={() => removeItem(item.variantId)} className="text-sm text-[var(--out-muted)] hover:text-[var(--out-bark)]">
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="out-card mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-[var(--out-muted)]">Subtotal</p>
          <p className="font-display text-2xl text-[var(--out-bark)]">{money(subtotal)}</p>
          {hasItemsWithoutPrice ? (
            <p className="mt-1 text-xs text-amber-700">Some items need a valid price before checkout.</p>
          ) : !signedIn ? (
            <p className="mt-1 text-xs text-[var(--out-muted)]">Sign in to place the order.</p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={checkingOut || hasItemsWithoutPrice}
          onClick={() => void goCheckout()}
          className="out-btn sm:min-w-[12rem]"
        >
          {checkingOut ? 'Please wait…' : signedIn ? 'Checkout' : 'Sign in to checkout'}
        </button>
      </div>
    </div>
  )
}
