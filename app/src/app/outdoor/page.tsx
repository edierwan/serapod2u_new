import OutdoorCampaignHero from '@/components/outdoor/OutdoorCampaignHero'
import OutdoorCategoryNav from '@/components/outdoor/OutdoorCategoryNav'
import OutdoorProductGrid from '@/components/outdoor/OutdoorProductGrid'
import { listOutdoorProducts, outdoorCategoryNavFromProducts } from '@/lib/outdoor/catalog'

export const dynamic = 'force-dynamic'

export default async function OutdoorHomePage() {
  const { products } = await listOutdoorProducts({ sort: 'newest', limit: 24 })
  const circles = outdoorCategoryNavFromProducts(products)
  const chair = circles.find((item) => item.key === 'chair')
  const slides = [
    {
      src: '/outdoor/brand/banners/shop-now.jpg',
      alt: 'Shop SeraOutdoor now',
      href: '/outdoor/shop',
      bg: '#3f1c1f',
      overlay: null,
    },
    {
      src: '/outdoor/brand/banners/moonchair.jpg',
      alt: 'Moonchair new design',
      href: chair?.href || '/outdoor/shop',
      bg: '#572932',
      overlay: null,
    },
    {
      src: '/outdoor/brand/banners/mix-n-match.jpg',
      alt: 'Mix and match SeraOutdoor',
      href: '/outdoor/shop',
      bg: '#f1e6b2',
      overlay: null,
    },
    {
      src: '/outdoor/brand/banners/burgundy.jpg',
      alt: 'Burgundy collection',
      href: '/outdoor/shop',
      bg: '#f1e6b2',
      overlay: null,
    },
  ]

  return (
    <>
      <OutdoorCategoryNav items={circles} />
      <OutdoorCampaignHero slides={slides} />

      {products.length > 0 ? (
        <section className="px-4 sm:px-8 pb-8 pt-8">
          <div className="mx-auto max-w-xl sm:max-w-3xl">
            <h2 className="mb-5 text-center font-display text-3xl tracking-tight text-[var(--out-bark)] sm:text-4xl">
              Best Sellers
            </h2>
            <OutdoorProductGrid products={products.slice(0, 8)} />
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
