'use client'

import Link from 'next/link'
import { Package } from 'lucide-react'
import type { StorefrontProduct } from '@/lib/storefront/products'

function resolveVariantImageUrl(rawPath: string | null) {
  if (!rawPath) return null
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) return rawPath

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return rawPath

  const cleanPath = rawPath.replace(/^\/+/, '')
  const bucket = 'product-variants'
  const objectPath = cleanPath.startsWith(`${bucket}/`)
    ? cleanPath.slice(bucket.length + 1)
    : cleanPath

  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
}

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2,
  }).format(price)
}

export default function StorefrontProductCard({ product }: { product: StorefrontProduct }) {
  const imageUrl = resolveVariantImageUrl(product.image_url)

  return (
    <Link
      href={`/store/products/${product.id}`}
      className="group block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-lg hover:border-gray-200 transition-all duration-300"
    >
      {/* Image */}
      <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.product_name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-300">
            <Package className="h-12 w-12 mb-2" />
            <span className="text-xs">No image</span>
          </div>
        )}
        {product.variant_count > 1 && (
          <span className="absolute top-3 right-3 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white bg-gray-900/80 backdrop-blur-sm rounded-full">
            {product.variant_count} Variants
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 group-hover:text-blue-600 transition-colors">
          {product.product_name}
        </h3>

        {/* Tags */}
        {product.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {product.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 text-[10px] font-medium text-gray-500 bg-gray-100 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Price */}
        <div className="mt-3">
          {product.starting_price != null && product.starting_price > 0 ? (
            <div>
              <span className="text-xs text-gray-400">Starting from</span>
              <p className="text-lg font-bold text-gray-900">
                {formatPrice(product.starting_price)}
              </p>
            </div>
          ) : (
            <p className="text-sm font-medium text-gray-400 italic">Contact for price</p>
          )}
        </div>
      </div>
    </Link>
  )
}
