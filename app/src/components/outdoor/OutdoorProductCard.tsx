'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ShoppingBag } from 'lucide-react'
import type { StorefrontProduct } from '@/lib/storefront/products'

function formatPrice(price: number | null) {
  if (price == null || price <= 0) return 'Price on request'
  return `RM ${price.toFixed(2)}`
}

export default function OutdoorProductCard({ product }: { product: StorefrontProduct }) {
  const swatches = product.colorSwatches || []
  const [active, setActive] = useState(0)
  const image = swatches[active]?.imageUrl || product.image_url

  return (
    <article className="flex h-full flex-col">
      <Link href={`/outdoor/shop/${product.id}`} className="block">
        <div className="aspect-[4/5] rounded-[1.35rem] bg-white p-3 sm:p-4 overflow-hidden">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={product.product_name}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="h-full w-full rounded-xl bg-[var(--out-sand)]/40" />
          )}
        </div>
      </Link>

      {swatches.length > 0 ? (
        <div className="mt-3 flex items-center gap-1.5 px-1">
          {swatches.map((swatch, i) => (
            <button
              key={`${swatch.hex}-${i}`}
              type="button"
              aria-label={swatch.label}
              onClick={() => setActive(i)}
              className={`h-3.5 w-3.5 rounded-full border ${
                i === active ? 'border-[var(--out-bark)] scale-110' : 'border-black/10'
              }`}
              style={{ background: swatch.hex }}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-start justify-between gap-2 px-1">
        <h3 className="text-sm font-semibold leading-snug text-[var(--out-bark)]">
          {product.product_name}
        </h3>
        {product.specLabel ? (
          <p className="shrink-0 text-xs text-[var(--out-muted)]">{product.specLabel}</p>
        ) : null}
      </div>
      <p className="mt-1 px-1 text-sm font-medium text-[var(--out-bark)]">{formatPrice(product.starting_price)}</p>

      <div className="mt-3 flex items-center gap-2">
        <Link
          href={`/outdoor/shop/${product.id}`}
          className="inline-flex h-10 flex-1 items-center justify-center rounded-full bg-[var(--out-moss)] text-sm font-semibold text-white hover:bg-[var(--out-moss-deep)]"
        >
          Buy Now
        </Link>
        <Link
          href={`/outdoor/shop/${product.id}`}
          aria-label={`Open ${product.product_name}`}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--out-bark)]/15 text-[var(--out-bark)]"
        >
          <ShoppingBag className="h-4 w-4" />
        </Link>
      </div>
    </article>
  )
}
