'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { Package, Play } from 'lucide-react'
import type { StorefrontProduct } from '@/lib/storefront/products'

/**
 * Resolve a variant image/media URL to a full public URL.
 * Handles both 'avatars' (admin upload default) and 'product-variants' buckets.
 */
function resolveMediaUrl(rawPath: string | null) {
  if (!rawPath) return null
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) return rawPath

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return rawPath

  const cleanPath = rawPath.replace(/^\/+/, '')

  const knownBuckets = ['product-variants', 'avatars']
  for (const bucket of knownBuckets) {
    if (cleanPath.startsWith(`${bucket}/`)) {
      const objectPath = cleanPath.slice(bucket.length + 1)
      return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
    }
  }

  return `${supabaseUrl}/storage/v1/object/public/avatars/${cleanPath}`
}

/** Detect media type from URL extension */
function getMediaType(url: string | null): 'image' | 'video' | 'animation' {
  if (!url) return 'image'
  const lower = url.toLowerCase()
  if (lower.match(/\.(mp4|webm|mov)($|\?)/)) return 'video'
  if (lower.match(/\.(json|lottie)($|\?)/)) return 'animation'
  return 'image'
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2,
  }).format(price)
}

export default function StorefrontProductCard({ product }: { product: StorefrontProduct }) {
  const imageUrl = resolveMediaUrl(product.image_url)
  const animationUrl = resolveMediaUrl(product.animation_url)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [imgError, setImgError] = useState(false)
  const [useFallback, setUseFallback] = useState(false)

  const primaryUrl = animationUrl || imageUrl
  const fallbackUrl = animationUrl ? imageUrl : null
  const displayUrl = useFallback ? fallbackUrl : primaryUrl
  const mediaType = displayUrl ? getMediaType(displayUrl) : 'image'

  const handleMediaError = () => {
    if (!useFallback && fallbackUrl) {
      setUseFallback(true)
    } else {
      setImgError(true)
    }
  }

  return (
    <Link
      href={`/store/products/${product.id}`}
      className="group block overflow-hidden rounded-2xl border border-[var(--sera-line)] bg-[var(--sera-surface)] shadow-[0_12px_32px_-22px_rgba(20,18,16,0.3)] transition-all duration-300 hover:border-[var(--sera-orange)]/30 hover:shadow-[0_16px_40px_-16px_rgba(20,18,16,0.28)]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[var(--sera-surface)]">
        {displayUrl && !imgError ? (
          mediaType === 'video' ? (
            <video
              ref={videoRef}
              src={displayUrl}
              muted
              loop
              playsInline
              autoPlay
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              onError={handleMediaError}
            />
          ) : (
            <img
              src={displayUrl}
              alt={product.product_name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              loading="lazy"
              onError={handleMediaError}
            />
          )
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-[var(--sera-muted)]/50">
            <Package className="mb-2 h-12 w-12" />
            <span className="text-xs">No image</span>
          </div>
        )}

        {mediaType === 'video' && displayUrl && !imgError && (
          <div className="absolute bottom-3 left-3 rounded-full bg-[var(--sera-ink)]/70 p-1.5 backdrop-blur-sm">
            <Play className="h-3 w-3 fill-white text-white" />
          </div>
        )}

        {product.variant_count > 1 && (
          <span className="absolute top-3 right-3 rounded-lg bg-[var(--sera-ink)]/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
            {product.variant_count} Variants
          </span>
        )}
      </div>

      <div className="p-4 sm:p-5">
        <h3 className="font-display text-sm font-semibold text-[var(--sera-ink)] line-clamp-2 transition-colors group-hover:text-[var(--sera-orange)]">
          {product.product_name}
        </h3>

        {product.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {product.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-[var(--sera-mist)] px-2 py-0.5 text-[10px] font-medium text-[var(--sera-muted)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3">
          {product.starting_price != null && product.starting_price > 0 ? (
            <div>
              <span className="text-xs text-[var(--sera-muted)]">Starting from</span>
              <p className="font-display text-lg font-semibold text-[var(--sera-ink)]">
                {formatPrice(product.starting_price)}
              </p>
            </div>
          ) : (
            <p className="text-sm font-medium italic text-[var(--sera-muted)]">Contact for price</p>
          )}
        </div>
      </div>
    </Link>
  )
}
