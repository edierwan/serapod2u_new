import type { StorefrontProduct, StorefrontVariant } from '@/lib/storefront/products'
import { isSellablePrice } from '@/lib/storefront/price-rules'

/** A product can only be bought once master data gives it a price the gateway accepts. */
export function isOutdoorPriced(product: Pick<StorefrontProduct, 'starting_price' | 'display_price'>) {
  return isSellablePrice(product.display_price) || isSellablePrice(product.starting_price)
}

export function hasPricedVariant(variants: Pick<StorefrontVariant, 'suggested_retail_price'>[]) {
  return variants.some((variant) => isSellablePrice(variant.suggested_retail_price))
}
