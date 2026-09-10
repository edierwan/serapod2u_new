import Link from 'next/link'
import { listOutdoorProducts, listOutdoorCategories } from '@/lib/outdoor/catalog'
import OutdoorProductGrid from '@/components/outdoor/OutdoorProductGrid'
import OutdoorNewsletter from '@/components/outdoor/OutdoorNewsletter'

export const dynamic = 'force-dynamic'

const BENEFITS = [
  { title: 'Built for outdoors', text: 'Gear for hiking, camping, and everyday outdoor use.' },
  { title: 'Pay securely', text: 'Checkout through our payment partner. Orders mark paid after confirmation.' },
  { title: 'Ship in Malaysia', text: 'Pick a courier rate at checkout, then track once we ship.' },
  { title: 'We’re here', text: 'Message us anytime, or track with your email and order number.' },
]

export default async function OutdoorHomePage() {
  const [{ products: featured }, { products: newest }, categories] = await Promise.all([
    listOutdoorProducts({ sort: 'newest', limit: 8 }),
    listOutdoorProducts({ sort: 'newest', limit: 4 }),
    listOutdoorCategories(),
  ])

  const bestSellers = featured.slice(0, 4)
  // Only show a Categories block when there are real Outdoor sub-collections (2+)
  const categoryCards = categories.length > 1 ? categories.slice(0, 6) : []

  return (
    <>
      <section className="relative min-h-[68vh] sm:min-h-[72vh] overflow-hidden text-white">
        <div
          className="absolute inset-0 out-drift out-fade"
          style={{
            backgroundImage:
              'linear-gradient(180deg, rgba(15,28,22,0.45) 0%, rgba(15,28,22,0.55) 45%, rgba(15,28,22,0.72) 100%), url(https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=2400&q=80)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8 min-h-[68vh] sm:min-h-[72vh] flex flex-col items-center justify-center text-center py-14 sm:py-16">
          <h1 className="font-display text-5xl sm:text-7xl lg:text-[5.4rem] leading-[0.95] tracking-tight max-w-4xl out-rise">
            Serapod Outdoor
          </h1>
          <p className="mt-5 max-w-xl text-base sm:text-lg text-white/85 leading-relaxed out-rise out-rise-d1">
            Gear for trails, camps, and weekends outside. Shop online and get it delivered in Malaysia.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 out-rise out-rise-d2">
            <Link
              href="/outdoor/shop"
              className="inline-flex h-12 items-center rounded-md bg-[var(--out-moss)] px-6 text-sm font-semibold text-white hover:bg-[var(--out-moss-deep)] transition"
            >
              Shop now
            </Link>
            <Link
              href="/outdoor/about"
              className="inline-flex h-12 items-center rounded-md border border-white/35 px-6 text-sm font-medium text-white/90 hover:bg-white/10 transition"
            >
              About us
            </Link>
          </div>
        </div>
      </section>

      {categoryCards.length > 0 ? (
        <section className="mx-auto max-w-6xl px-5 sm:px-8 py-16 sm:py-20">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl sm:text-4xl tracking-tight">Categories</h2>
            <p className="mt-3 text-[var(--out-muted)]">Browse Outdoor collections.</p>
          </div>
          <div className="mt-10 grid gap-4 grid-cols-2 md:grid-cols-3">
            {categoryCards.map((cat) => (
              <Link
                key={cat.id}
                href={`/outdoor/shop?category=${cat.id}`}
                className="rounded-xl border border-[var(--out-line)] bg-white/80 p-5 hover:border-[var(--out-moss)] transition-colors"
              >
                <h3 className="font-display text-lg text-[var(--out-ink)]">{cat.name}</h3>
                <p className="mt-1 text-xs text-[var(--out-muted)]">Shop</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {newest.length > 0 ? (
        <section className="border-y border-[var(--out-line)] bg-white/40 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-5 sm:px-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-3xl sm:text-4xl tracking-tight">New in</h2>
                <p className="mt-2 text-[var(--out-muted)]">Latest Outdoor products.</p>
              </div>
              <Link href="/outdoor/shop?sort=newest" className="text-sm font-semibold text-[var(--out-moss)] hover:underline">
                See all
              </Link>
            </div>
            <OutdoorProductGrid products={newest} />
          </div>
        </section>
      ) : null}

      {bestSellers.length > 0 ? (
        <section className="mx-auto max-w-6xl px-5 sm:px-8 py-16 sm:py-20">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl sm:text-4xl tracking-tight">Popular picks</h2>
              <p className="mt-2 text-[var(--out-muted)]">Outdoor products shoppers often choose.</p>
            </div>
            <Link href="/outdoor/shop" className="text-sm font-semibold text-[var(--out-moss)] hover:underline">
              Shop all
            </Link>
          </div>
          <OutdoorProductGrid products={bestSellers} />
        </section>
      ) : null}

      {featured.length === 0 ? (
        <section className="mx-auto max-w-3xl px-5 py-20 text-center">
          <h2 className="font-display text-3xl">Outdoor catalogue coming soon</h2>
          <p className="mt-3 text-sm text-[var(--out-muted)]">
            No Outdoor category/products were found yet. Add products under an “Outdoor” category in the catalogue,
            or set OUTDOOR_CATEGORY_ID / OUTDOOR_BRAND_ID.
          </p>
        </section>
      ) : null}

      <section className="relative min-h-[340px] sm:min-h-[420px] overflow-hidden text-white">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: "url('/outdoor/band-trail.jpg')",
          }}
          role="img"
          aria-label="Hiking trail through forest"
        />
        <div className="absolute inset-0 bg-[rgba(12,22,18,0.45)]" />
        <div className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8 min-h-[340px] sm:min-h-[420px] flex flex-col items-center justify-center text-center py-16">
          <h2
            className="font-display text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-tight max-w-3xl"
            style={{ textShadow: '0 2px 24px rgba(0,0,0,0.45)' }}
          >
            Made for time outside.
          </h2>
          <p
            className="mt-5 text-base sm:text-lg text-white leading-relaxed max-w-lg"
            style={{ textShadow: '0 1px 12px rgba(0,0,0,0.5)' }}
          >
            Serapod Outdoor is our outdoor shop — simple to browse, pay, and track.
          </p>
        </div>
      </section>

      <section className="border-y border-[var(--out-line)] bg-white/40 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl sm:text-4xl tracking-tight">Why shop with us</h2>
            <p className="mt-3 text-[var(--out-muted)]">
              Simple shopping — from browse to delivery in Malaysia.
            </p>
          </div>
          <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2">
            {BENEFITS.map((item) => (
              <div key={item.title} className="border-t border-[var(--out-line)] pt-5">
                <h3 className="font-display text-2xl tracking-tight text-[var(--out-ink)]">{item.title}</h3>
                <p className="mt-2 text-sm text-[var(--out-muted)] leading-relaxed max-w-md">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--out-line)] bg-[var(--out-sand)]">
        <div className="mx-auto max-w-6xl px-5 sm:px-8 py-14 sm:py-16 grid lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-16 items-end">
          <div>
            <h2 className="font-display text-3xl sm:text-4xl tracking-tight text-[var(--out-ink)]">
              Stay in the loop
            </h2>
            <p className="mt-3 text-sm sm:text-base text-[var(--out-muted)] leading-relaxed max-w-md">
              Leave your email for Outdoor updates. Need help with an order? Use the links below.
            </p>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link href="/outdoor/shipping-returns" className="text-[var(--out-moss)] font-semibold hover:underline">
                Shipping & Returns
              </Link>
              <Link href="/outdoor/contact" className="text-[var(--out-moss)] font-semibold hover:underline">
                Contact
              </Link>
              <Link href="/outdoor/track" className="text-[var(--out-moss)] font-semibold hover:underline">
                Track order
              </Link>
            </div>
          </div>
          <div>
            <OutdoorNewsletter />
          </div>
        </div>
      </section>
    </>
  )
}
