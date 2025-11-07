import type { Metadata } from 'next'
import { Navbar } from '@/components/marketing/Navbar'
import { Hero } from '@/components/marketing/Hero'
import { Features } from '@/components/marketing/Features'
import { Benefits } from '@/components/marketing/Benefits'
import { DemoForm } from '@/components/marketing/DemoForm'
import { Footer } from '@/components/marketing/Footer'
import { StructuredData } from '@/components/marketing/StructuredData'

export const metadata: Metadata = {
  title: 'Serapod2u - Complete Supply Chain Management Platform',
  description: 'Track, trace, and optimize your entire supply chain from manufacturer to retail. QR-powered journey builder with real-time insights. Trusted by manufacturers across Southeast Asia.',
  keywords: [
    'supply chain management',
    'QR code tracking',
    'product traceability',
    'inventory management',
    'warehouse management',
    'journey builder',
    'manufacturer software',
    'distributor platform',
    'retail tracking',
    'Southeast Asia'
  ],
  authors: [{ name: 'Serapod2u' }],
  creator: 'Serapod2u Supply Chain',
  publisher: 'Serapod2u',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://serapod2u.com',
    title: 'Serapod2u - Complete Supply Chain Management Platform',
    description: 'Track, trace, and optimize your entire supply chain from manufacturer to retail. QR-powered journey builder with real-time insights.',
    siteName: 'Serapod2u',
    images: [
      {
        url: '/images/features/SupplyChainStatusFlow.png',
        width: 1200,
        height: 630,
        alt: 'Serapod2u Supply Chain Dashboard'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Serapod2u - Complete Supply Chain Management Platform',
    description: 'Track, trace, and optimize your entire supply chain from manufacturer to retail.',
    images: ['/images/features/SupplyChainStatusFlow.png']
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1
    }
  },
  verification: {
    // Add your verification codes when ready
    // google: 'your-google-verification-code',
    // yandex: 'your-yandex-verification-code',
  }
}

export default function HomePage() {
  return (
    <>
      <StructuredData />
      <main className="min-h-screen bg-white">
        <Navbar />
        <Hero />
        <div id="features">
          <Features />
        </div>
        <div id="benefits">
          <Benefits />
        </div>
        <DemoForm />
        <Footer />
      </main>
    </>
  )
}