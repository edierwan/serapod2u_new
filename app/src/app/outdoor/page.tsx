import Link from 'next/link'
import { listOutdoorProducts } from '@/lib/outdoor/catalog'
import OutdoorCampaignHero from '@/components/outdoor/OutdoorCampaignHero'
import OutdoorProductRail from '@/components/outdoor/OutdoorProductRail'
import type { StorefrontProduct } from '@/lib/storefront/products'

export const dynamic = 'force-dynamic'

function findProduct(products: StorefrontProduct[], ...needles: string[]) {
  const lower = needles.map((n) => n.toLowerCase())
  return (
    products.find((p) => {
      const name = p.product_name.toLowerCase()
      return lower.some((n) => name.includes(n))
    }) || null
  )
}

function shopHref(product: StorefrontProduct | null) {
  return product ? `/outdoor/shop/${product.id}` : '/outdoor/shop'
}

export default async function OutdoorHomePage() {
  const { products } = await listOutdoorProducts({ sort: 'newest', limit: 24 })

  const chair = findProduct(products, 'chair', 'moonchair')
  const tumbler = findProduct(products, 'tumbler')
  const mat = findProduct(products, 'mat', 'mattress', 'pad')

  const collections = [
    {
      label: 'Moon Chair',
      src: '/outdoor/brand/moonchair.jpg',
      href: shopHref(chair),
    },
    {
      label: 'Tumbler',
      src: '/outdoor/brand/tumbler.jpg',
      href: shopHref(tumbler),
    },
    {
      label: 'Camp Mat',
      src: '/outdoor/brand/mat.jpg',
      href: shopHref(mat),
    },
  ]

  const circles = [
    { label: 'New in', href: '/outdoor/shop?sort=newest', image: '/outdoor/brand/icon-1.png' },
    ...collections.map((item) => ({
      label: item.label,
      href: item.href,
      image: item.src,
    })),
  ]

  const slides = [
    {
      src: '/outdoor/brand/photos/artboard-1.jpg',
      alt: 'City is loud. Find your silence.',
      href: '/outdoor/shop',
      bg: '#ffffff',
    },
    {
      src: '/outdoor/brand/photos/artboard-2.jpg',
      alt: 'SeraOutdoor Moon Chair and Tumbler',
      href: shopHref(chair),
      bg: '#f1e6b2',
    },
    {
      src: '/outdoor/brand/photos/artboard-5.jpg',
      alt: 'SeraOutdoor Camp Mat and Tumbler',
      href: shopHref(mat),
      bg: '#572932',
    },
  ]

  return (
    <>
      <nav className="bg-[var(--out-cream)]">
        <div className="mx-auto max-w-6xl px-4 sm:px-8 pt-3 pb-2 flex items-start justify-start sm:justify-center gap-4 sm:gap-8 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {circles.map((item) => (
            <Link
              key={`${item.href}-${item.label}`}
              href={item.href}
              className="flex w-[4.25rem] sm:w-24 shrink-0 flex-col items-center text-center"
            >
              <span className="flex h-[4.25rem] w-[4.25rem] sm:h-24 sm:w-24 items-center justify-center overflow-hidden rounded-full bg-white p-1.5 sm:p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.image} alt="" className="max-h-full max-w-full object-contain" />
              </span>
              <span className="mt-2 line-clamp-2 text-[11px] sm:text-xs font-medium leading-snug text-[var(--out-ink)]">
                {item.label}
              </span>
            </Link>
          ))}
        </div>
      </nav>

      <OutdoorCampaignHero slides={slides} />

      <section className="px-3 sm:px-5 lg:px-8 pb-10 sm:pb-14">
        <div className="mx-auto max-w-6xl grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          {collections.map((item) => (
            <Link key={item.src} href={item.href} className="group relative block overflow-hidden rounded-[1.75rem] bg-[var(--out-cream)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.src} alt={item.label} className="block w-full h-auto" />
              <span className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 inline-flex h-9 sm:h-11 items-center rounded-full bg-white px-4 sm:px-5 text-sm font-semibold text-[var(--out-ink)]">
                Shop now
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="px-3 sm:px-5 lg:px-8 pb-10 sm:pb-14">
        <div className="mx-auto max-w-6xl">
          <Link href="/outdoor/shop" className="relative block overflow-hidden rounded-[1.75rem] bg-[#f1e6b2]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/outdoor/brand/photos/race-collections.jpg"
              alt="SeraOutdoor"
              className="block w-full h-auto"
            />
          </Link>
        </div>
      </section>

      {products.length > 0 ? (
        <section className="px-3 sm:px-5 lg:px-8 pb-10 sm:pb-14">
          <div className="mx-auto max-w-6xl">
            <div className="flex items-baseline justify-between gap-4 mb-5 sm:mb-6 px-1">
              <h2 className="font-display text-2xl sm:text-4xl tracking-tight">Best Sellers</h2>
              <Link href="/outdoor/shop" className="text-sm font-semibold text-[var(--out-moss)] hover:underline">
                Shop all
              </Link>
            </div>
            <OutdoorProductRail products={products.slice(0, 8)} />
          </div>
        </section>
      ) : (
        <section className="mx-auto max-w-3xl px-5 py-20 text-center">
          <h2 className="font-display text-3xl">Outdoor catalogue coming soon</h2>
          <p className="mt-3 text-sm text-[var(--out-muted)]">
            Add products under an “Outdoor” category, or set OUTDOOR_CATEGORY_ID / OUTDOOR_BRAND_ID.
          </p>
        </section>
      )}
    </>
  )
}
