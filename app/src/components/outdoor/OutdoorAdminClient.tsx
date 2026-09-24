'use client'

import { useEffect, useState } from 'react'
import { getStorageUrl } from '@/lib/utils'

type ProductColor = {
  id: string
  name: string
  price: number
}

type ProductRow = {
  id: string
  name: string
  price: number
  description: string
  imageUrl: string
  colors: ProductColor[]
}

function money(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return ''
  return `RM ${amount.toFixed(2)}`
}

export default function OutdoorAdminClient() {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [subscribers, setSubscribers] = useState(0)
  const [products, setProducts] = useState<ProductRow[]>([])
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
      setProducts((data.products || []).map((item: any) => ({
        id: item.id,
        name: item.name || '',
        price: Number(item.price) || 0,
        description: item.description || '',
        imageUrl: item.imageUrl || '',
        colors: Array.isArray(item.colors) ? item.colors : [],
      })))
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
        {subscribers} newsletter subscriber{subscribers === 1 ? '' : 's'}. Products are added and edited in the main admin. This page shows the same Outdoor products, with the same name and price.
      </p>
      {error ? <p className="mt-6 text-sm text-red-600">{error}</p> : null}
      <div className="mt-10 grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
        {products.length === 0 ? <p className="text-sm text-[var(--out-muted)]">No outdoor products yet.</p> : null}
        {products.map((product) => (
          <article key={product.id} className="w-full">
            <div className="overflow-hidden rounded-[1.6rem] bg-white p-4 sm:p-6">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getStorageUrl(product.imageUrl) || product.imageUrl} alt="" className="mx-auto h-auto max-h-56 w-full object-contain" />
              ) : (
                <div className="flex aspect-square items-center justify-center text-sm text-[var(--out-muted)]">No photo yet</div>
              )}
            </div>
            <div className="mt-4 space-y-2 rounded-[1.6rem] bg-white p-4 sm:p-5">
              <h2 className="text-lg font-semibold text-[var(--out-bark)]">{product.name}</h2>
              {money(product.price) ? <p className="text-sm font-medium text-[var(--out-bark)]">From {money(product.price)}</p> : null}
              {product.colors.length > 0 ? (
                <ul className="space-y-1 text-sm text-[var(--out-muted)]">
                  {product.colors.map((color) => (
                    <li key={color.id || color.name}>
                      {color.name || 'Variant'}{money(color.price) ? ` · ${money(color.price)}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              {product.description ? <p className="text-sm leading-relaxed text-[var(--out-muted)]">{product.description}</p> : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
