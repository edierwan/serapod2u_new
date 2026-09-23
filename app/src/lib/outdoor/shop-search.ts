import type { StorefrontProduct } from '@/lib/storefront/products'

export type OutdoorShopSort = 'newest' | 'price_asc' | 'price_desc' | 'name_asc'

/** Match the shopper's words against the product name, code, and short spec only. */
export function outdoorProductMatchesSearch(
  product: Pick<StorefrontProduct, 'product_name' | 'product_code' | 'specLabel'>,
  query: string,
) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = `${product.product_name} ${product.product_code || ''} ${product.specLabel || ''}`.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export function sortOutdoorProducts(
  products: StorefrontProduct[],
  sort: OutdoorShopSort,
  newestRank: Map<string, number>,
) {
  const list = [...products]
  if (sort === 'name_asc') {
    list.sort((a, b) => a.product_name.localeCompare(b.product_name))
  } else if (sort === 'price_asc') {
    list.sort((a, b) => (a.starting_price ?? Number.POSITIVE_INFINITY) - (b.starting_price ?? Number.POSITIVE_INFINITY))
  } else if (sort === 'price_desc') {
    list.sort((a, b) => (b.starting_price ?? -1) - (a.starting_price ?? -1))
  } else {
    list.sort((a, b) => (newestRank.get(a.id) ?? 0) - (newestRank.get(b.id) ?? 0))
  }
  return list
}
