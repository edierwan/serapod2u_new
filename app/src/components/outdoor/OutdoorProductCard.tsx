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
  // Whole shop is Outdoor — don't repeat "OUTDOOR" on every card
  const showCategory = Boolean(product.category_name) && !isGenericOutdoorLabel(product.category_name)

  return (
    <Link
      href={`/outdoor/shop/${product.id}`}
      className="group block rounded-xl border border-[var(--out-line)] bg-white overflow-hidden hover:border-[var(--out-moss)] transition-colors h-full"
    >
      <div className="aspect-[4/5] bg-[var(--out-sand)]/40 overflow-hidden">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.product_name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-[var(--out-moss)]/20 to-[var(--out-sand)]" />
        )}
      </div>
      <div className="p-4">
        {showCategory ? (
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--out-muted)]">{product.category_name}</p>
        ) : null}
        <h3 className={`font-display text-lg text-[var(--out-ink)] group-hover:text-[var(--out-moss)] transition-colors line-clamp-2 ${showCategory ? 'mt-1' : ''}`}>
          {product.product_name}
        </h3>
        <p className="mt-2 text-sm font-semibold text-[var(--out-moss-deep)]">{formatPrice(product.starting_price)}</p>
      </div>
    </Link>
  )
}
