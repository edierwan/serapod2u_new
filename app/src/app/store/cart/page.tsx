'use client'

import { useCart } from '@/lib/storefront/cart-context'
import Link from 'next/link'
import { Trash2, Minus, Plus, ShoppingBag, ArrowLeft, ShoppingCart } from 'lucide-react'

function formatPrice(price: number) {
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(price)
}

export default function CartPage() {
  const { items, removeItem, updateQuantity, totalItems, subtotal, clearCart, hasItemsWithoutPrice } =
    useCart()

  if (items.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <ShoppingBag className="h-20 w-20 text-[var(--sera-muted)]/40 mx-auto mb-6" />
        <h1 className="font-display text-2xl font-semibold text-[var(--sera-ink)] mb-2">Your cart is empty</h1>
        <p className="text-[var(--sera-muted)] mb-8">Looks like you haven't added anything yet.</p>
        <Link
          href="/store/products"
          className="inline-flex items-center gap-2 h-11 px-6 bg-[var(--sera-ink)] text-white rounded-xl text-sm font-semibold hover:bg-[var(--sera-ink-soft)] transition"
        >
          <ShoppingCart className="h-4 w-4" />
          Browse Products
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[var(--sera-ink)]">Shopping Cart</h1>
          <p className="text-sm text-[var(--sera-muted)] mt-0.5">
            {totalItems} item{totalItems !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={clearCart}
          className="text-xs text-red-500 hover:text-red-700 font-medium transition"
        >
          Clear all
        </button>
      </div>

      {/* Items */}
      <div className="space-y-4">
        {items.map((item) => (
          <div
            key={item.variantId}
            className="flex gap-4 p-4 bg-white rounded-xl border border-[var(--sera-line)] shadow-sm"
          >
            {/* Image */}
            <div className="flex-none w-20 h-20 rounded-lg bg-[var(--sera-mist)] border border-[var(--sera-line)] overflow-hidden flex items-center justify-center">
              {item.imageUrl ? (
                <img src={item.imageUrl} alt={item.productName} className="w-full h-full object-cover" />
              ) : (
                <ShoppingBag className="h-8 w-8 text-[var(--sera-muted)]/40" />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <Link
                href={`/store/products/${item.productId}`}
                className="text-sm font-semibold text-[var(--sera-ink)] hover:underline line-clamp-1"
              >
                {item.productName}
              </Link>
              <p className="text-xs text-[var(--sera-muted)] mt-0.5">{item.variantName}</p>
              <p className="text-sm font-bold text-[var(--sera-ink)] mt-1">
                {item.price != null && item.price > 0 ? formatPrice(item.price) : 'Price TBD'}
              </p>
            </div>

            {/* Qty + Remove */}
            <div className="flex flex-col items-end justify-between">
              <button
                onClick={() => removeItem(item.variantId)}
                className="text-[var(--sera-muted)]/70 hover:text-red-500 transition"
                aria-label="Remove"
              >
                <Trash2 className="h-4 w-4" />
              </button>

              <div className="inline-flex items-center border border-[var(--sera-line)] rounded-lg overflow-hidden">
                <button
                  onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                  className="h-8 w-8 flex items-center justify-center text-[var(--sera-muted)] hover:bg-[var(--sera-mist)] transition"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="h-8 w-8 flex items-center justify-center text-xs font-semibold border-x border-[var(--sera-line)]">
                  {item.quantity}
                </span>
                <button
                  onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                  className="h-8 w-8 flex items-center justify-center text-[var(--sera-muted)] hover:bg-[var(--sera-mist)] transition"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="mt-8 bg-[var(--sera-mist)] rounded-xl p-6 border border-[var(--sera-line)]">
        <div className="flex justify-between text-sm text-[var(--sera-muted)] mb-2">
          <span>Subtotal</span>
          <span className="font-semibold text-[var(--sera-ink)]">{formatPrice(subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm text-[var(--sera-muted)] mb-4">
          <span>Shipping</span>
          <span className="text-[var(--sera-muted)]/70">Calculated at checkout</span>
        </div>
        <div className="border-t border-[var(--sera-line)] pt-4 flex justify-between text-base font-bold text-[var(--sera-ink)]">
          <span>Estimated Total</span>
          <span>{formatPrice(subtotal)}</span>
        </div>

        {hasItemsWithoutPrice && (
          <p className="text-xs text-amber-600 mt-3">
            * Some items don't have a price. Please remove them or contact us before checkout.
          </p>
        )}

        <Link
          href="/store/checkout"
          className={`mt-6 w-full h-12 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition ${
            hasItemsWithoutPrice
              ? 'bg-[var(--sera-line)] text-[var(--sera-muted)] cursor-not-allowed pointer-events-none'
              : 'bg-[var(--sera-orange)] text-white hover:bg-[var(--sera-orange-deep)] active:scale-[0.98]'
          }`}
        >
          Proceed to Checkout
        </Link>

        <Link
          href="/store/products"
          className="flex items-center justify-center gap-1.5 text-sm text-[var(--sera-muted)] hover:text-[var(--sera-ink)]/80 mt-4 transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Continue Shopping
        </Link>
      </div>
    </div>
  )
}
