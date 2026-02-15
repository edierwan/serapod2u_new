import { listProducts, listCategories } from '@/lib/storefront/products'
import StorefrontProductCard from '@/components/storefront/ProductCard'
import ProductListingControls from '@/components/storefront/ListingControls'
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {params.search ? `Results for "${params.search}"` : 'All Products'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {total} product{total !== 1 ? 's' : ''} found
        </p>
      </div>

      {/* Controls */}
      <ProductListingControls
        categories={categories}
        currentCategory={params.category}
        currentSort={sort}
        currentSearch={params.search}
      />

      {/* Product Grid */}
      {products.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 mt-6">
          {products.map((product) => (
            <StorefrontProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <Package className="h-16 w-16 text-gray-200 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700">No products found</h3>
          <p className="text-sm text-gray-400 mt-1">Try adjusting your search or filters</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-10">
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
                className={`h-9 min-w-[36px] px-3 flex items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                  page === currentPage
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
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
