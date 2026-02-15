'use client'

import { useState, useMemo } from 'react'
import {
  Package,
  ShoppingCart,
  Check,
  Minus,
  Plus,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useCart } from '@/lib/storefront/cart-context'
import type { StorefrontProductDetail, StorefrontVariant } from '@/lib/storefront/products'

interface Props {
  product: StorefrontProductDetail
}

function formatPrice(price: number | null) {
  if (price == null || price <= 0) return null
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(price)
}

export default function ProductDetailClient({ product }: Props) {
  const { addItem } = useCart()
  const defaultVariant = product.variants.find((v) => v.is_default) || product.variants[0] || null

  const [selectedVariant, setSelectedVariant] = useState<StorefrontVariant | null>(defaultVariant)
  const [quantity, setQuantity] = useState(1)
  const [justAdded, setJustAdded] = useState(false)

  // Collect all unique images from variants
  const images = useMemo(() => {
    const urls = product.variants
      .map((v) => v.image_url)
      .filter((url): url is string => !!url)
    return [...new Set(urls)]
  }, [product.variants])

  const [currentImage, setCurrentImage] = useState(0)

  const activeImage = selectedVariant?.image_url || images[currentImage] || null

  const formattedPrice = selectedVariant ? formatPrice(selectedVariant.suggested_retail_price) : null

  const handleAddToCart = () => {
    if (!selectedVariant) return
    addItem(
      {
        productId: product.id,
        variantId: selectedVariant.id,
        productName: product.product_name,
        variantName: selectedVariant.variant_name,
        price: selectedVariant.suggested_retail_price,
        imageUrl: selectedVariant.image_url,
      },
      quantity,
    )
    setJustAdded(true)
    setTimeout(() => setJustAdded(false), 2000)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
      {/* ── Image Gallery ── */}
      <div className="space-y-4">
        <div className="relative aspect-square rounded-2xl bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center">
          {activeImage ? (
            <img
              src={activeImage}
              alt={product.product_name}
              className="object-contain w-full h-full p-4"
            />
          ) : (
            <Package className="h-24 w-24 text-gray-200" />
          )}

          {/* Arrows when multiple images */}
          {images.length > 1 && !selectedVariant?.image_url && (
            <>
              <button
                onClick={() => setCurrentImage((p) => (p === 0 ? images.length - 1 : p - 1))}
                className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/80 backdrop-blur flex items-center justify-center shadow hover:bg-white transition"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentImage((p) => (p === images.length - 1 ? 0 : p + 1))}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/80 backdrop-blur flex items-center justify-center shadow hover:bg-white transition"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>

        {/* Thumbnails */}
        {images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {images.map((url, i) => (
              <button
                key={i}
                onClick={() => {
                  setCurrentImage(i)
                  setSelectedVariant(null)
                }}
                className={`flex-none w-16 h-16 rounded-lg border overflow-hidden ${
                  currentImage === i && !selectedVariant?.image_url
                    ? 'border-gray-900 ring-2 ring-gray-900/20'
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                <img src={url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Product Info ── */}
      <div className="space-y-6">
        {/* Category & Brand badges */}
        <div className="flex flex-wrap gap-2">
          {product.category_name && (
            <span className="px-2.5 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
              {product.category_name}
            </span>
          )}
          {product.brand_name && (
            <span className="px-2.5 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs font-medium">
              {product.brand_name}
            </span>
          )}
        </div>

        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 leading-tight">
          {product.product_name}
        </h1>

        {product.short_description && (
          <p className="text-gray-500 text-sm leading-relaxed">{product.short_description}</p>
        )}

        {/* Price */}
        <div>
          {formattedPrice ? (
            <span className="text-3xl font-bold text-gray-900">{formattedPrice}</span>
          ) : (
            <span className="text-lg text-gray-400">Contact for price</span>
          )}
        </div>

        {/* Variant selector */}
        {product.variants.length > 1 && (
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              Variant
            </label>
            <div className="flex flex-wrap gap-2">
              {product.variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setSelectedVariant(v)
                    setQuantity(1)
                  }}
                  className={`relative px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                    selectedVariant?.id === v.id
                      ? 'border-gray-900 bg-gray-900 text-white shadow-sm'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
                  }`}
                >
                  {v.variant_name}
                  {selectedVariant?.id === v.id && (
                    <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="h-2.5 w-2.5 text-white" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quantity */}
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Quantity</label>
          <div className="inline-flex items-center border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="h-10 w-10 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="h-10 w-12 flex items-center justify-center text-sm font-semibold border-x border-gray-200">
              {quantity}
            </span>
            <button
              onClick={() => setQuantity((q) => q + 1)}
              className="h-10 w-10 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Add to Cart */}
        <button
          onClick={handleAddToCart}
          disabled={!selectedVariant || justAdded}
          className={`w-full h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
            justAdded
              ? 'bg-green-500 text-white'
              : 'bg-gray-900 text-white hover:bg-gray-800 active:scale-[0.98]'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {justAdded ? (
            <>
              <Check className="h-4 w-4" />
              Added to Cart
            </>
          ) : (
            <>
              <ShoppingCart className="h-4 w-4" />
              Add to Cart
            </>
          )}
        </button>

        {/* Description */}
        {product.product_description && (
          <div className="border-t border-gray-100 pt-6 mt-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Description</h3>
            <div className="prose prose-sm prose-gray max-w-none text-gray-600">
              {product.product_description.split('\n').map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          </div>
        )}

        {/* Variant details table */}
        {selectedVariant?.attributes && Object.keys(selectedVariant.attributes).length > 0 && (
          <div className="border-t border-gray-100 pt-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Specifications</h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {Object.entries(selectedVariant.attributes).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-gray-500 capitalize">{key.replace(/_/g, ' ')}</dt>
                  <dd className="text-gray-900 font-medium">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {/* SKU */}
        <div className="text-xs text-gray-400 space-x-3">
          <span>SKU: {selectedVariant?.variant_code || product.product_code}</span>
          {selectedVariant?.barcode && <span>Barcode: {selectedVariant.barcode}</span>}
        </div>
      </div>
    </div>
  )
}
