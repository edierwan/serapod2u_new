'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart, type CartItem } from '@/lib/storefront/cart-context'

const POLL_MS = 3000
const MAX_POLLS = 10

/** Re-checks the order while the gateway confirmation is still on its way. */
export function OutdoorPaymentPoller() {
  const router = useRouter()
  const [tries, setTries] = useState(0)

  useEffect(() => {
    if (tries >= MAX_POLLS) return
    const timer = window.setTimeout(() => {
      setTries((n) => n + 1)
      router.refresh()
    }, POLL_MS)
    return () => window.clearTimeout(timer)
  }, [router, tries])

  if (tries < MAX_POLLS) {
    return (
      <div className="mt-6 flex items-center justify-center gap-2 text-xs text-[var(--out-muted)]" aria-live="polite">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--out-moss)]" />
        Checking with the payment provider…
      </div>
    )
  }
  return (
    <p className="mt-6 text-xs text-[var(--out-muted)]">
      This is taking longer than usual. Your order stays in My account and updates as soon as the payment is confirmed.
    </p>
  )
}

/** Puts the items of an unpaid order back in the bag and returns to checkout. */
export function OutdoorRetryBag({ items }: { items: CartItem[] }) {
  const router = useRouter()
  const { addItem, items: bag } = useCart()
  const [busy, setBusy] = useState(false)

  if (items.length === 0) return null

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        for (const item of items) {
          if (bag.some((existing) => existing.variantId === item.variantId)) continue
          const { quantity, ...rest } = item
          addItem(rest, quantity)
        }
        router.push('/outdoor/checkout')
      }}
      className="out-btn w-full"
    >
      {busy ? 'Opening checkout…' : 'Try again'}
    </button>
  )
}
