import Link from 'next/link'
import { listProducts, listCategories } from '@/lib/storefront/products'
import { listActiveStoreBanners, getHeroConfig } from '@/lib/storefront/banners'
import StorefrontProductCard from '@/components/storefront/ProductCard'
import StoreHeroSlider from '@/components/storefront/StoreHeroSlider'
import SplitHeroLayout from '@/components/storefront/SplitHeroLayout'
import { ArrowRight, Package, ShieldCheck, Truck } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function StorefrontHomePage() {
  // Fetch featured products (latest) + banners + config in parallel
  const [{ products }, categories, banners, heroConfig] = await Promise.all([
    listProducts({ sort: 'newest', limit: 6 }),
    listCategories(),
    listActiveStoreBanners(),
    getHeroConfig(),
  ])

  return (
    <div>
      {/* Hero Section — dynamic layout based on heroConfig */}
      {banners.length > 0 ? (
        (() => {
          // Separate banners by layout slot
          const carouselBanners = banners.filter(
            (b) => !b.layout_slot || b.layout_slot === 'carousel' || b.layout_slot === 'split_main'
          ).slice(0, heroConfig.max_slides)
          const sideTop = banners.find((b) => b.layout_slot === 'split_side_top') || null
          const sideBottom = banners.find((b) => b.layout_slot === 'split_side_bottom') || null

          if (heroConfig.layout_type === 'split' && (sideTop || sideBottom)) {
            return (
              <SplitHeroLayout
                mainBanners={carouselBanners}
                sideBanners={[sideTop, sideBottom]}
                interval={heroConfig.auto_rotate_interval}
              />
            )
          }

          return (
            <StoreHeroSlider
              banners={carouselBanners}
              interval={heroConfig.auto_rotate_interval}
            />
          )
        })()
      ) : (
        <section className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background: 'radial-gradient(circle at 30% 50%, rgba(59,130,246,0.15), transparent 50%), radial-gradient(circle at 70% 50%, rgba(168,85,247,0.1), transparent 50%)',
            }}
          />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
            <div className="max-w-2xl">
              <span className="inline-block px-3 py-1 text-xs font-medium tracking-wider uppercase text-blue-400 bg-blue-500/10 rounded-full mb-4">
                New Collection
              </span>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-[1.1] tracking-tight">
                Premium Products,{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-400">
                  Delivered Right.
                </span>
              </h1>
              <p className="mt-5 text-lg text-gray-300 max-w-lg leading-relaxed">
                Discover our curated selection of quality devices and accessories.
                Shop with confidence — fast checkout, secure payments.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/store/products"
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-blue-600 rounded-full hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/25"
                >
                  Shop Now
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-gray-300 bg-white/10 backdrop-blur-sm rounded-full hover:bg-white/20 transition-all border border-white/10"
                >
                  Business Login
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Trust Badges */}
      <section className="border-b border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center">
                <Truck className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Reliable Delivery</p>
                <p className="text-xs text-gray-500">Nationwide coverage</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 h-10 w-10 rounded-full bg-green-50 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Secure Payments</p>
                <p className="text-xs text-gray-500">SSL encrypted checkout</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 h-10 w-10 rounded-full bg-purple-50 flex items-center justify-center">
                <Package className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Quality Guaranteed</p>
                <p className="text-xs text-gray-500">Authentic products only</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      {categories.length > 0 && (
        <section className="bg-white py-12 sm:py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Shop by Category</h2>
                <p className="text-sm text-gray-500 mt-1">Find what you need</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {categories.map((cat) => (
                <Link
                  key={cat.id}
                  href={`/store/products?category=${cat.id}`}
                  className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 hover:border-gray-300 hover:shadow-md transition-all bg-white"
                >
                  <div className="h-12 w-12 rounded-full bg-gray-100 group-hover:bg-gray-200 flex items-center justify-center transition-colors overflow-hidden">
                    {cat.image_url ? (
                      <img
                        src={cat.image_url}
                        alt={cat.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Package className="h-5 w-5 text-gray-600" />
                    )}
                  </div>
                  <span className="text-sm font-medium text-gray-700 text-center line-clamp-2 group-hover:text-gray-900">
                    {cat.name}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Featured Products */}
      <section className="bg-gray-50 py-12 sm:py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Featured Products</h2>
              <p className="text-sm text-gray-500 mt-1">Our latest and best-selling items</p>
            </div>
            <Link
              href="/store/products"
              className="hidden sm:inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              View All
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {products.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map((product) => (
                <StorefrontProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
              <Package className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No products available yet</p>
              <p className="text-sm text-gray-400 mt-1">Check back soon for new arrivals</p>
            </div>
          )}

          <div className="sm:hidden mt-6 text-center">
            <Link
              href="/store/products"
              className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              View All Products
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900">Ready to get started?</h2>
          <p className="text-gray-500 mt-2 max-w-md mx-auto">
            Browse our full catalog and find exactly what you need.
          </p>
          <Link
            href="/store/products"
            className="inline-flex items-center gap-2 mt-6 px-8 py-3 text-sm font-semibold text-white bg-gray-900 rounded-full hover:bg-gray-800 transition-colors"
          >
            Browse Products
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  )
}
