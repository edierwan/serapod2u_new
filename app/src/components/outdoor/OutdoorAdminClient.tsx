'use client'

import { useEffect, useState } from 'react'
import StorefrontProductCard from '@/components/storefront/ProductCard'
import type { StorefrontProduct } from '@/lib/storefront/products'
import '@/app/store/store.css'

export default function OutdoorAdminClient() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [subscribers, setSubscribers] = useState(0)
  const [products, setProducts] = useState<StorefrontProduct[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      const access = await fetch('/api/outdoor/fulfilment/access')
      const accessData = await access.json().catch(() => null)
      if (!accessData?.allowed) {
        setAllowed(false)
        return
      }
      setAllowed(true)
      const res = await fetch('/api/outdoor/products')
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || 'Could not load products')
        return
      }
      setSubscribers(data.subscribers || 0)
      setProducts(Array.isArray(data.products) ? data.products : [])
    }
    void load()
  }, [])

  if (allowed === null) return <div className="mx-auto max-w-6xl px-5 py-16 text-sm text-[var(--out-muted)]">Loading…</div>
  if (!allowed) return <div className="mx-auto max-w-6xl px-5 py-16 text-sm text-[var(--out-bark)]">This desk is for Outdoor staff.</div>

  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--out-muted)]">Admin</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Outdoor desk</h1>
      <p className="mt-2 max-w-2xl text-sm text-[var(--out-muted)]">
        {subscribers} newsletter subscriber{subscribers === 1 ? '' : 's'}. Products are added and edited in the main admin. These are the same cards as the main shop.
      </p>
      {error ? <p className="mt-6 text-sm text-red-600">{error}</p> : null}
      <div className="sera-store mt-10 bg-transparent">
        {products.length === 0 ? <p className="text-sm text-[var(--out-muted)]">No outdoor products yet.</p> : null}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <StorefrontProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </div>
  )
}
