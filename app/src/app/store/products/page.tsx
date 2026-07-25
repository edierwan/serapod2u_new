import { listProducts, listCategories } from '@/lib/storefront/products'
import StorefrontProductCard from '@/components/storefront/ProductCard'
import ProductListingControls from '@/components/storefront/ListingControls'
import StoreReveal from '@/components/storefront/StoreReveal'
import { Package } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'All Products',
}

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{
    search?: string
    category?: string
    sort?: string
    page?: string
  }>
}

export default async function ProductsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const currentPage = parseInt(params.page || '1', 10)
  const sort = (params.sort as any) || 'newest'

  const [{ products, total, limit }, categories] = await Promise.all([
    listProducts({
      search: params.search,
      category: params.category,
      sort,
      page: currentPage,
      limit: 12,
    }),
    listCategories(),
  ])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 sm:py-10">
      <StoreReveal>
        <div className="mb-8">
          <h1 className="font-display text-2xl font-semibold text-[var(--sera-ink)] sm:text-3xl">
            {params.search ? `Results for "${params.search}"` : 'All Products'}
          </h1>
          <p className="mt-1 text-sm text-[var(--sera-muted)]">
            {total} product{total !== 1 ? 's' : ''} found
          </p>
        </div>
      </StoreReveal>

      <StoreReveal delay={80}>
        <ProductListingControls
          categories={categories}
          currentCategory={params.category}
          currentSort={sort}
          currentSearch={params.search}
        />
      </StoreReveal>

      {products.length > 0 ? (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((product, i) => (
            <StoreReveal key={product.id} delay={Math.min((i % 8) * 50, 350)}>
              <StorefrontProductCard product={product} />
            </StoreReveal>
          ))}
        </div>
      ) : (
        <StoreReveal>
          <div className="py-20 text-center">
            <Package className="mx-auto mb-4 h-16 w-16 text-[var(--sera-muted)]/30" />
            <h3 className="font-display text-lg font-semibold text-[var(--sera-ink)]">No products found</h3>
            <p className="mt-1 text-sm text-[var(--sera-muted)]">Try adjusting your search or filters</p>
          </div>
        </StoreReveal>
      )}

      {totalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
            const searchParams = new URLSearchParams()
            if (params.search) searchParams.set('search', params.search)
            if (params.category) searchParams.set('category', params.category)
            if (sort !== 'newest') searchParams.set('sort', sort)
            if (page > 1) searchParams.set('page', String(page))
            const href = `/store/products${searchParams.toString() ? `?${searchParams}` : ''}`

            return (
              <a
                key={page}
                href={href}
                className={`flex h-9 min-w-[36px] items-center justify-center rounded-xl px-3 text-sm font-medium transition-colors ${
                  page === currentPage
                    ? 'bg-[var(--sera-ink)] text-white'
                    : 'text-[var(--sera-muted)] hover:bg-[var(--sera-mist)] hover:text-[var(--sera-ink)]'
                }`}
              >
                {page}
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
