import type { Metadata } from 'next'

import { CartProvider } from '@/lib/storefront/cart-context'

export const metadata: Metadata = {
  title: {
    default: 'Serapod2U Campaign',
    template: '%s | Serapod2U',
  },
  description: 'Serapod2U curated product campaign.',
}

export default function LandingPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <div className="min-h-screen bg-white text-slate-950">
        {children}
      </div>
    </CartProvider>
  )
}