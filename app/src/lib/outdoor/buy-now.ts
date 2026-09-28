import type { CartItem } from '@/lib/storefront/cart-context'

/** Buy Now checks out one product on its own and leaves the bag as it is. */
export const OUTDOOR_BUY_NOW_KEY = 'outdoor-buy-now'
export const OUTDOOR_BUY_NOW_CHECKOUT = '/outdoor/checkout?mode=buy-now'

export function parseOutdoorBuyNow(raw: string | null): CartItem | null {
  if (!raw) return null
  try {
    const item = JSON.parse(raw)
    if (!item || typeof item !== 'object') return null
    if (typeof item.variantId !== 'string' || !item.variantId) return null
    if (typeof item.productId !== 'string' || typeof item.productName !== 'string') return null
    const quantity = Math.floor(Number(item.quantity))
    if (!Number.isFinite(quantity) || quantity < 1) return null
    const price = item.price == null ? null : Number(item.price)
    return {
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productName,
      variantName: typeof item.variantName === 'string' ? item.variantName : '',
      price: price != null && Number.isFinite(price) ? price : null,
      imageUrl: typeof item.imageUrl === 'string' ? item.imageUrl : null,
      quantity,
    }
  } catch {
    return null
  }
}

export function saveOutdoorBuyNow(item: CartItem) {
  try {
    sessionStorage.setItem(OUTDOOR_BUY_NOW_KEY, JSON.stringify(item))
    return true
  } catch {
    return false
  }
}

export function readOutdoorBuyNow(): CartItem | null {
  try {
    return parseOutdoorBuyNow(sessionStorage.getItem(OUTDOOR_BUY_NOW_KEY))
  } catch {
    return null
  }
}

export function clearOutdoorBuyNow() {
  try {
    sessionStorage.removeItem(OUTDOOR_BUY_NOW_KEY)
  } catch {
    // Private mode
  }
}
