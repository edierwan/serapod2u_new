import Link from 'next/link'
import type { StorefrontProduct } from '@/lib/storefront/products'

function formatPrice(price: number | null) {
  if (price == null || price <= 0) return 'Price on request'
  return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(price)
}

function isGenericOutdoorLabel(name: string | null | undefined) {
  return /^outdoor$/i.test(String(name || '').trim())
}

export default function OutdoorProductCard({ product }: { product: StorefrontProduct }) {
  const showCategory = Boolean(product.category_name) && !isGenericOutdoorLabel(product.category_name)

  return (
    <Link href={`/outdoor/shop/${product.id}`} className="group block h-full">
      <div className="aspect-square rounded-[1.25rem] bg-white flex items-center justify-center p-5 overflow-hidden">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.product_name}
            className="max-h-full max-w-full object-contain transition duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="h-full w-full rounded-xl bg-[var(--out-sand)]" />
        )}
      </div>
      <div className="pt-3 px-1">
        {showCategory ? (
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--out-muted)]">{product.category_name}</p>
        ) : null}
        <h3 className={`text-sm sm:text-base font-semibold leading-snug text-[var(--out-ink)] group-hover:text-[var(--out-moss)] transition-colors line-clamp-2 ${showCategory ? 'mt-1' : ''}`}>
          {product.product_name}
        </h3>
        <p className="mt-1.5 text-sm font-semibold text-[var(--out-ink)]">{formatPrice(product.starting_price)}</p>
      </div>
    </Link>
  )
}
