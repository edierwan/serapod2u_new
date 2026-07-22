import type { Metadata } from 'next'
import { Manrope, Syne } from 'next/font/google'
import './globals.css'
import '@/styles/sera-shell.css'
import { AuthProvider } from '@/components/providers/AuthProvider'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { LanguageProvider } from '@/lib/i18n/LanguageProvider'
import { Toaster } from '@/components/ui/toaster'

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-sera-display',
  display: 'swap',
})

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sera-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Serapod2U - Supply Chain Management System',
  description: 'Professional multi-tenant Supply Chain Management System for retail distribution',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Serapod2U'
  },
  icons: {
    icon: '/icons/icon-192x192.png',
    apple: '/icons/icon-192x192.png'
  }
}

export function generateViewport() {
  return {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 5,
    userScalable: true,
    viewportFit: 'cover',
    themeColor: '#141210'
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${syne.variable} ${manrope.variable}`}>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <LanguageProvider>
            <AuthProvider>
              {children}
            </AuthProvider>
          </LanguageProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}