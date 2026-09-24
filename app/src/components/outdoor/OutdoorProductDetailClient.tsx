'use client'

import { useEffect, useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useCart } from '@/lib/storefront/cart-context'
import type { StorefrontProductDetail, StorefrontVariant } from '@/lib/storefront/products'
import { outdoorColorFromText, outdoorFallbackSwatches, outdoorSpecLabel, outdoorStaticImage, outdoorSwatchesFromVariants } from '@/lib/outdoor/merch'
import { useRouter } from 'next/navigation'

function formatPrice(price: number | null) {
  if (price == null || price <= 0) return 'Price on request'
  return `RM ${price.toFixed(2)}`
}

export default function OutdoorProductDetailClient({ product }: { product: StorefrontProductDetail }) {
  const { addItem } = useCart()
  const router = useRouter()
  const swatches = useMemo(() => {
    const parsed = outdoorSwatchesFromVariants(
      product.variants.map((v) => ({
        variant_name: v.variant_name,
        image_url: v.image_url,
        attributes: v.attributes,
      })),
      product.product_name,
    ).map((swatch) => ({
      ...swatch,
      imageUrl:
        swatch.imageUrl && !swatch.imageUrl.startsWith('/outdoor/products/')
          ? swatch.imageUrl
          : outdoorStaticImage(product.product_name, swatch.hex) || swatch.imageUrl,
    }))
    return parsed.length > 0 ? parsed : outdoorFallbackSwatches(product.product_name)
  }, [product.product_name, product.variants])

  const variantForSwatch = (hex: string | null) => {
    if (!hex) return product.variants.find((v) => v.is_default) || product.variants[0] || null
    const match = product.variants.find((v) => {
      const attrs = v.attributes || {}
      const fromAttr = outdoorColorFromText(String(attrs.color || attrs.colour || attrs.hex || ''))
      const fromName = outdoorColorFromText(v.variant_name)
      return (fromAttr || fromName)?.hex.toLowerCase() === hex.toLowerCase()
    })
    return match || product.variants.find((v) => v.is_default) || product.variants[0] || null
  }

  const defaultVariant = product.variants.find((v) => v.is_default) || product.variants[0] || null
  const [selected, setSelected] = useState<StorefrontVariant | null>(defaultVariant)
  const [qty, setQty] = useState(1)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    setSelected(defaultVariant)
  }, [defaultVariant])

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

  const spec = outdoorSpecLabel(product.product_name, selected?.variant_name, selected?.attributes)
  const selectedHex =
    outdoorSwatchesFromVariants(selected ? [selected] : [])[0]?.hex || swatches[0]?.hex || null
  const [activeHex, setActiveHex] = useState<string | null>(selectedHex)
  const displayHex = String(activeHex || selectedHex || '')
  const displayImage =
    swatches.find((s) => s.hex.toLowerCase() === displayHex.toLowerCase())?.imageUrl ||
    gallery[0]

  const productPrice = selected?.suggested_retail_price && selected.suggested_retail_price > 0
    ? selected.suggested_retail_price
    : defaultVariant?.suggested_retail_price ?? null

  const handleBuy = () => {
    if (!selected || !productPrice || productPrice <= 0 || adding) return
    setAdding(true)
    addItem(
      {
        productId: product.id,
        variantId: selected.id,
        productName: product.product_name,
        variantName: selected.variant_name,
        price: productPrice,
        imageUrl: selected.image_url || gallery[0] || null,
      },
      qty,
    )
    router.push('/outdoor/checkout')
  }

  const description = String(product.product_description || product.short_description || '').trim()

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-4 sm:px-8">
      <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
        <div className="overflow-hidden rounded-[1.6rem] bg-white p-4 sm:p-6">
          {displayImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={displayImage}
              src={displayImage}
              alt={product.product_name}
              className="mx-auto h-auto w-full max-h-[58vh] object-contain"
            />
          ) : (
            <div className="aspect-square bg-[var(--out-sand)]/30" />
          )}
        </div>

        <div className="lg:pt-4">
          {swatches.length > 0 ? (
            <div className="flex items-center gap-2">
              {swatches.map((swatch) => {
                const selectedSwatch = activeHex?.toLowerCase() === swatch.hex.toLowerCase()
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    aria-label={swatch.label}
                    onClick={() => {
                      setActiveHex(swatch.hex)
                      const next = variantForSwatch(swatch.hex)
                      if (next) setSelected(next)
                    }}
                    className={`h-4 w-4 rounded-full border ${
                      selectedSwatch ? 'border-[var(--out-bark)] ring-2 ring-[var(--out-bark)]/20' : 'border-black/10'
                    }`}
                    style={{ background: swatch.hex }}
                  />
                )
              })}
            </div>
          ) : product.variants.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {product.variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelected(v)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    selected?.id === v.id
                      ? 'border-[var(--out-bark)] bg-[var(--out-bark)] text-[var(--out-cream)]'
                      : 'border-[var(--out-line)] text-[var(--out-bark)]'
                  }`}
                >
                  {v.variant_name}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex items-start justify-between gap-3">
            <h1 className="font-display text-3xl tracking-tight text-[var(--out-bark)]">{product.product_name}</h1>
            {spec ? <p className="pt-2 text-sm text-[var(--out-muted)]">{spec}</p> : null}
          </div>
          <p className="mt-1 text-lg font-semibold text-[var(--out-bark)]">
            {formatPrice(productPrice)}
          </p>
          {description ? (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-[var(--out-muted)]">{description}</p>
          ) : null}

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={handleBuy}
              disabled={!productPrice || productPrice <= 0 || adding}
              className="inline-flex h-12 flex-1 items-center justify-center rounded-full bg-[var(--out-moss)] text-sm font-semibold text-white hover:bg-[var(--out-moss-deep)] disabled:opacity-40"
            >
              Buy Now
            </button>
            <div className="inline-flex h-12 items-center rounded-2xl bg-white px-2 text-[var(--out-bark)]">
              <button type="button" className="p-2" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-6 text-center text-sm font-semibold">{qty}</span>
              <button type="button" className="p-2" onClick={() => setQty((q) => q + 1)} aria-label="Increase">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
