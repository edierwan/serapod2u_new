'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Minus, Plus, ShoppingBag } from 'lucide-react'
import { useCart } from '@/lib/storefront/cart-context'
import type { StorefrontProductDetail, StorefrontVariant } from '@/lib/storefront/products'

function formatPrice(price: number | null) {
  if (price == null || price <= 0) return 'Price on request'
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(price)
}

export default function OutdoorProductDetailClient({ product }: { product: StorefrontProductDetail }) {
  const { addItem } = useCart()
  const defaultVariant = product.variants.find((v) => v.is_default) || product.variants[0] || null
  const [selected, setSelected] = useState<StorefrontVariant | null>(defaultVariant)
  const [qty, setQty] = useState(1)
  const [inCart, setInCart] = useState(false)

  const gallery = useMemo(() => {
    const urls: string[] = []
    const push = (u: string | null | undefined) => {
      if (!u || urls.includes(u)) return
      urls.push(u)
    }
    if (selected?.media?.length) {
      selected.media.forEach((m) => push(m.url))
    } else {
      push(selected?.image_url)
    }
    product.variants.forEach((v) => {
      if (v.media?.length) v.media.forEach((m) => push(m.url))
      else push(v.image_url)
    })
    return urls
  }, [product.variants, selected])

  const [activeImage, setActiveImage] = useState(0)

  const handleAdd = () => {
    if (!selected || !selected.suggested_retail_price || selected.suggested_retail_price <= 0) return
    if (inCart) return
    addItem(
      {
        productId: product.id,
        variantId: selected.id,
        productName: product.product_name,
        variantName: selected.variant_name,
        price: selected.suggested_retail_price,
        imageUrl: selected.image_url || gallery[0] || null,
      },
      qty,
    )
    setInCart(true)
  }

  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10 sm:py-14 grid lg:grid-cols-2 gap-10">
      <div>
        <div className="aspect-square rounded-2xl overflow-hidden border border-[var(--out-line)] bg-[var(--out-sand)]/30">
          {gallery[activeImage] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={gallery[activeImage]} alt={product.product_name} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-[var(--out-moss)]/20 to-[var(--out-sand)]" />
          )}
        </div>
        {gallery.length > 1 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {gallery.map((url, i) => (
              <button
                key={url + i}
                type="button"
                onClick={() => setActiveImage(i)}
                className={`h-16 w-16 rounded-lg overflow-hidden border ${i === activeImage ? 'border-[var(--out-moss)]' : 'border-[var(--out-line)]'}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div>
        <Link href="/outdoor/shop" className="text-sm text-[var(--out-muted)] hover:text-[var(--out-moss)]">
          ← Back to shop
        </Link>
        {product.category_name ? (
          <p className="mt-4 text-[11px] uppercase tracking-[0.14em] text-[var(--out-muted)]">{product.category_name}</p>
        ) : null}
        <h1 className="mt-2 font-display text-3xl sm:text-4xl tracking-tight text-[var(--out-ink)]">
          {product.product_name}
        </h1>
        <p className="mt-4 text-2xl font-semibold text-[var(--out-moss-deep)]">
          {formatPrice(selected?.suggested_retail_price ?? null)}
        </p>
        {(product.short_description || product.product_description) ? (
          <p className="mt-5 text-sm text-[var(--out-muted)] leading-relaxed whitespace-pre-line">
            {product.short_description || product.product_description}
          </p>
        ) : null}

        {product.variants.length > 1 ? (
          <div className="mt-8">
            <p className="text-sm font-medium text-[var(--out-ink)]">Option</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {product.variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    setSelected(v)
                    setActiveImage(0)
                    setInCart(false)
                  }}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    selected?.id === v.id
                      ? 'border-[var(--out-moss)] bg-[var(--out-moss)]/10 text-[var(--out-moss-deep)]'
                      : 'border-[var(--out-line)] text-[var(--out-ink-soft)]'
                  }`}
                >
                  {v.variant_name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-8 flex items-center gap-4">
          {!inCart ? (
            <>
              <div className="inline-flex items-center border border-[var(--out-line)] rounded-md">
                <button type="button" className="p-3" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-10 text-center text-sm font-semibold">{qty}</span>
                <button type="button" className="p-3" onClick={() => setQty((q) => q + 1)} aria-label="Increase">
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!selected?.suggested_retail_price || selected.suggested_retail_price <= 0}
                className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-md bg-[var(--out-moss)] px-5 text-sm font-semibold text-white hover:bg-[var(--out-moss-deep)] disabled:opacity-40"
              >
                <ShoppingBag className="h-4 w-4" />
                Add to cart
              </button>
            </>
          ) : (
            <div className="flex flex-1 flex-col sm:flex-row gap-3">
              <Link
                href="/outdoor/checkout"
                className="inline-flex h-12 flex-1 items-center justify-center rounded-md bg-[var(--out-moss)] px-5 text-sm font-semibold text-white hover:bg-[var(--out-moss-deep)]"
              >
                Checkout
              </Link>
              <Link
                href="/outdoor/cart"
                className="inline-flex h-12 flex-1 items-center justify-center rounded-md border border-[var(--out-line)] px-5 text-sm font-semibold"
              >
                View cart
              </Link>
            </div>
          )}
        </div>

        {inCart ? (
          <p className="mt-3 text-sm text-[var(--out-moss-deep)]">Added to your cart.</p>
        ) : null}
      </div>
    </div>
  )
}
