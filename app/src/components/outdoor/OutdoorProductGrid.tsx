import type { StorefrontProduct } from '@/lib/storefront/products'
import OutdoorProductCard from '@/components/outdoor/OutdoorProductCard'

/**
 * Count-aware product grid — fills the full row with no empty column on the right.
 */
export default function OutdoorProductGrid({ products }: { products: StorefrontProduct[] }) {
  if (products.length === 0) return null

  const n = products.length
  const cols =
    n === 1
      ? 'grid-cols-1 max-w-sm'
      : n === 2
        ? 'grid-cols-2'
        : n === 3
          ? 'grid-cols-2 lg:grid-cols-3'
          : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'

  return (
    <div className={`mt-10 grid w-full gap-3 sm:gap-5 ${cols}`}>
      {products.map((p) => (
        <OutdoorProductCard key={p.id} product={p} />
      ))}
    </div>
  )
}
