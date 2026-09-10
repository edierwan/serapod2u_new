import type { Metadata } from 'next'
import { Manrope, Syne } from 'next/font/google'
import { CartProvider } from '@/lib/storefront/cart-context'
import OutdoorChrome from '@/components/outdoor/OutdoorChrome'
import OutdoorAnalytics from '@/components/outdoor/OutdoorAnalytics'
import './outdoor.css'

const display = Syne({
  subsets: ['latin'],
  variable: '--font-outdoor-display',
  display: 'swap',
})

const body = Manrope({
  subsets: ['latin'],
  variable: '--font-outdoor-body',
  display: 'swap',
})

const siteUrl =
  process.env.NEXT_PUBLIC_OUTDOOR_SITE_URL?.replace(/\/$/, '') || 'https://outdoor.serapod.com'

const gsc = String(process.env.NEXT_PUBLIC_OUTDOOR_GSC_VERIFICATION || '').trim()

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Serapod Outdoor',
    template: '%s | Serapod Outdoor',
  },
  description:
    'Premium outdoor lifestyle from Serapod Outdoor — gear and apparel for trails, camps, and open air. Secure checkout and Malaysia delivery.',
  openGraph: {
    title: 'Serapod Outdoor',
    description: 'Premium outdoor lifestyle from Serapod Outdoor.',
    url: siteUrl,
    siteName: 'Serapod Outdoor',
    type: 'website',
    locale: 'en_MY',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Serapod Outdoor',
    description: 'Premium outdoor lifestyle from Serapod Outdoor.',
  },
  ...(gsc
    ? {
        verification: {
          google: gsc,
        },
      }
    : {}),
}

export default function OutdoorLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider storageKey="serapod_outdoor_cart">
      <div className={`sera-outdoor ${display.variable} ${body.variable} min-h-screen`}>
        <OutdoorAnalytics />
        <OutdoorChrome>{children}</OutdoorChrome>
      </div>
    </CartProvider>
  )
}
