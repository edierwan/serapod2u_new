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
      ? 'grid-cols-1 max-w-sm mx-auto'
      : 'grid-cols-2'

  return (
    <div className={`mt-2 grid w-full gap-4 sm:gap-5 ${cols}`}>
      {products.map((p) => (
        <OutdoorProductCard key={p.id} product={p} />
      ))}
    </div>
  )
}
