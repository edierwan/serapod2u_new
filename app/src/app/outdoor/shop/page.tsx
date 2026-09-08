import Link from 'next/link'
import { listOutdoorProducts, listOutdoorCategories } from '@/lib/outdoor/catalog'
import OutdoorProductGrid from '@/components/outdoor/OutdoorProductGrid'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Shop' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function OutdoorShopPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const search = typeof params.search === 'string' ? params.search : ''
  const category = typeof params.category === 'string' ? params.category : ''
  const sortRaw = typeof params.sort === 'string' ? params.sort : 'newest'
  const sort = (['newest', 'price_asc', 'price_desc', 'name_asc'].includes(sortRaw)
    ? sortRaw
    : 'newest') as 'newest' | 'price_asc' | 'price_desc' | 'name_asc'

  const [{ products, total, scope }, categories] = await Promise.all([
    listOutdoorProducts({ search, category, sort, limit: 48 }),
    listOutdoorCategories(),
  ])

  // One Outdoor parent category → no category dropdown (redundant)
  const showCategoryFilter = categories.length > 1

  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8 py-12 sm:py-16">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-4xl sm:text-5xl tracking-tight text-[var(--out-ink)]">Shop</h1>
          <p className="mt-2 text-sm text-[var(--out-muted)]">
            {total} products
            {scope.matchedBy === 'none' ? ' · catalogue not linked yet' : ''}
          </p>
        </div>
      </div>

      <form
        className={`mt-8 grid gap-3 ${
          showCategoryFilter
            ? 'sm:grid-cols-[1fr_180px_160px_auto]'
            : 'sm:grid-cols-[1fr_160px_auto]'
        }`}
        method="get"
      >
        <input
          name="search"
          defaultValue={search}
          placeholder="Search products"
          className="h-11 rounded-md border border-[var(--out-line)] bg-white px-3 text-sm"
        />
        {showCategoryFilter ? (
          <select name="category" defaultValue={category} className="h-11 rounded-md border border-[var(--out-line)] bg-white px-3 text-sm">
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : null}
        <select name="sort" defaultValue={sort} className="h-11 rounded-md border border-[var(--out-line)] bg-white px-3 text-sm">
          <option value="newest">Newest</option>
          <option value="name_asc">Name A–Z</option>
          <option value="price_asc">Price low–high</option>
          <option value="price_desc">Price high–low</option>
        </select>
        <button type="submit" className="h-11 rounded-md bg-[var(--out-moss)] px-4 text-sm font-semibold text-white">
          Filter
        </button>
      </form>

      {products.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-dashed border-[var(--out-line)] p-10 text-center">
          <p className="font-display text-2xl text-[var(--out-moss)]">No products found</p>
          <Link href="/outdoor/shop" className="mt-4 inline-block text-sm font-semibold text-[var(--out-moss)] hover:underline">
            Clear filters
          </Link>
        </div>
      ) : (
        <OutdoorProductGrid products={products} />
      )}
    </div>
  )
}
