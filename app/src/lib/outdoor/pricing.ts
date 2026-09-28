import type { StorefrontProduct, StorefrontVariant } from '@/lib/storefront/products'

/** A product can only be bought once master data gives it a price above zero. */
export function isOutdoorPriced(product: Pick<StorefrontProduct, 'starting_price' | 'display_price'>) {
  const price = Number(product.display_price ?? product.starting_price)
  return Number.isFinite(price) && price > 0
}

export function hasPricedVariant(variants: Pick<StorefrontVariant, 'suggested_retail_price'>[]) {
  return variants.some((variant) => Number(variant.suggested_retail_price) > 0)
}
