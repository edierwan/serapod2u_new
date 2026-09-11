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
  const speaker = findProduct(products, 'speaker', 'bluetooth')
  const mat = findProduct(products, 'mat', 'mattress', 'pad')

  const series = [chair, tumbler, mat, speaker].filter((p): p is StorefrontProduct => Boolean(p))

  const circles = [
    products[0]
      ? { label: 'New in', href: '/outdoor/shop?sort=newest', image: products[0].image_url }
      : null,
    ...series.map((p) => ({
      label: p.product_name,
      href: shopHref(p),
      image: p.image_url,
    })),
  ].filter(Boolean) as { label: string; href: string; image: string | null }[]

  const slides = [
    {
      src: '/outdoor/lifestyle-moonchair.jpg',
      alt: 'Serapod Moonchair Highback',
      href: shopHref(chair),
      bg: '#f4f1ea',
    },
    {
      src: '/outdoor/lifestyle-speaker.jpg',
      alt: 'Serapod speaker on a hiking pack',
      href: shopHref(speaker),
      bg: '#1a1c16',
    },
    {
      src: '/outdoor/lifestyle-tumbler.jpg',
      alt: 'Serapod tumbler at camp',
      href: shopHref(tumbler),
      bg: '#2a241c',
    },
  ]

  return (
    <>
      {circles.length > 0 ? (
        <nav className="bg-[var(--out-cream)]">
          <div className="mx-auto max-w-6xl px-5 sm:px-8 pt-4 pb-3 flex items-start justify-start sm:justify-center gap-6 sm:gap-8 overflow-x-auto">
            {circles.map((item) => (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                className="flex w-[4.75rem] sm:w-24 shrink-0 flex-col items-center text-center"
              >
                <span className="flex h-[4.75rem] w-[4.75rem] sm:h-24 sm:w-24 items-center justify-center overflow-hidden rounded-full bg-white p-3">
                  {item.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.image} alt="" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="h-full w-full bg-[var(--out-sand)]" />
                  )}
                </span>
                <span className="mt-2 line-clamp-2 text-[11px] sm:text-xs font-medium leading-snug text-[var(--out-ink)]">
                  {item.label}
                </span>
              </Link>
            ))}
          </div>
        </nav>
      ) : null}

      <OutdoorCampaignHero slides={slides} />

      {series.length > 0 ? (
        <section className="px-3 sm:px-5 lg:px-8 pb-10 sm:pb-14">
          <div className="mx-auto max-w-6xl">
            <div className="flex items-end justify-between gap-4 mb-6 px-1">
              <h2 className="font-display text-2xl sm:text-4xl tracking-tight max-w-xl">Shop</h2>
              <Link href="/outdoor/shop" className="text-sm font-semibold text-[var(--out-moss)] hover:underline shrink-0">
                Shop all
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              {series.map((product) => (
                <Link
                  key={product.id}
                  href={shopHref(product)}
                  className="group rounded-[1.5rem] bg-white p-4 sm:p-6 text-center"
                >
                  <span className="mx-auto flex aspect-square items-center justify-center">
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image_url}
                        alt={product.product_name}
                        className="max-h-full max-w-full object-contain transition duration-300 group-hover:scale-[1.04]"
                      />
                    ) : null}
                  </span>
                  <span className="mt-3 block text-sm sm:text-base font-semibold text-[var(--out-ink)]">
                    {product.product_name}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="px-3 sm:px-5 lg:px-8 pb-10 sm:pb-14">
        <div className="mx-auto max-w-6xl grid md:grid-cols-2 gap-3 sm:gap-4">
          <Link href={shopHref(speaker)} className="group relative overflow-hidden rounded-[1.75rem] aspect-[4/5] bg-[#1a1c16]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/outdoor/lifestyle-speaker.jpg"
              alt="Serapod speaker on a hiking pack"
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
            <span className="absolute bottom-6 left-6 inline-flex h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-[var(--out-ink)]">
              Shop now
            </span>
          </Link>
          <Link href={shopHref(tumbler)} className="group relative overflow-hidden rounded-[1.75rem] aspect-[4/5] bg-[#2a241c]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/outdoor/lifestyle-tumbler.jpg"
              alt="Serapod tumbler at camp"
              className="absolute inset-0 h-full w-full object-cover object-center"
            />
            <span className="absolute bottom-6 left-6 inline-flex h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-[var(--out-ink)]">
              Shop now
            </span>
          </Link>
        </div>
      </section>

      {products.length > 0 ? (
        <section className="px-3 sm:px-5 lg:px-8 pb-10 sm:pb-14">
          <div className="mx-auto max-w-6xl">
            <div className="flex items-baseline justify-between gap-4 mb-6 px-1">
              <h2 className="font-display text-3xl sm:text-4xl tracking-tight">Best Sellers</h2>
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

      <section className="px-3 sm:px-5 lg:px-8 pb-14">
        <div className="mx-auto max-w-6xl grid sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="rounded-[1.5rem] bg-white px-6 py-8 text-center">
            <p className="font-display text-lg">Malaysia delivery</p>
            <p className="mt-1 text-sm text-[var(--out-muted)]">Courier rates at checkout.</p>
          </div>
          <div className="rounded-[1.5rem] bg-white px-6 py-8 text-center">
            <p className="font-display text-lg">Secure checkout</p>
            <p className="mt-1 text-sm text-[var(--out-muted)]">Paid after the payment provider confirms.</p>
          </div>
          <div className="rounded-[1.5rem] bg-white px-6 py-8 text-center">
            <p className="font-display text-lg">Track order</p>
            <p className="mt-1 text-sm text-[var(--out-muted)]">Use your order number and email.</p>
          </div>
        </div>
      </section>
    </>
  )
}
