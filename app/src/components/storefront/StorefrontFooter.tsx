import Link from 'next/link'
import StoreBrandMark from '@/components/storefront/StoreBrandMark'

export default function StorefrontFooter() {
  return (
    <footer className="border-t border-[var(--sera-line)] bg-[var(--sera-ink)] text-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <Link href="/store" className="mb-4 inline-block" aria-label="Serapod Store home">
              <StoreBrandMark variant="light" className="h-8 w-auto" />
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-white/60">
              Quality products delivered with care. Browse our collection and order with confidence.
            </p>
            <div className="mt-4 h-0.5 w-12 rounded-full bg-[var(--sera-orange)] store-accent-bar" />
          </div>

          <div>
            <h4 className="mb-4 font-display text-sm font-semibold">Shop</h4>
            <ul className="space-y-2.5">
              <li>
                <Link href="/store/products" className="text-sm text-white/60 transition-colors hover:text-white">
                  All Products
                </Link>
              </li>
              <li>
                <Link href="/store/cart" className="text-sm text-white/60 transition-colors hover:text-white">
                  Cart
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 font-display text-sm font-semibold">Account</h4>
            <ul className="space-y-2.5">
              <li>
                <Link href="/login" className="text-sm text-white/60 transition-colors hover:text-white">
                  Sign In
                </Link>
              </li>
              <li>
                <Link href="/store/account" className="text-sm text-white/60 transition-colors hover:text-white">
                  My Account
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-6">
          <p className="text-center text-xs text-white/40">
            &copy; {new Date().getFullYear()} Serapod. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
