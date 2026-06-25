import Link from 'next/link'
import Image from 'next/image'
import { Mail } from 'lucide-react'

/** Verified Serapod2U public contact channel (see marketing Footer / StructuredData). */
export const SUPPORT_EMAIL = 'info@serapod2u.com'

interface LegalPageLayoutProps {
  /** Page heading, e.g. "Privacy Policy" */
  title: string
  /** Human-readable last-updated date, e.g. "25 June 2026" */
  lastUpdated: string
  /** Short one-line summary shown under the title */
  intro?: string
  children: React.ReactNode
}

/**
 * Shared public layout for Serapod2U legal pages (privacy policy, terms of
 * service, data deletion). Renders without authentication — these routes are
 * allow-listed in middleware.ts so they return 200 for unauthenticated users.
 */
export function LegalPageLayout({ title, lastUpdated, intro, children }: LegalPageLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/images/logo.png"
              alt="Serapod2U Logo"
              width={32}
              height={32}
              className="h-8 w-8"
              priority
            />
            <span className="text-lg font-bold text-gray-900">Serapod2U</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/login" className="text-blue-600 hover:text-blue-700 hover:underline">
              Back to Login
            </Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: {lastUpdated}</p>
        {intro ? <p className="mt-4 text-base leading-relaxed text-gray-700">{intro}</p> : null}

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-gray-700">
          {children}
        </div>

        {/* Contact section */}
        <section className="mt-12 rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900">Contact Us</h2>
          <p className="mt-2 text-sm text-gray-700">
            For questions about this page or how Serapod2U handles your information, contact us at:
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
          >
            <Mail className="h-4 w-4" />
            {SUPPORT_EMAIL}
          </a>
        </section>

        {/* Footer nav */}
        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-200 pt-6 text-sm">
          <Link href="/" className="text-blue-600 hover:text-blue-700 hover:underline">
            Back to Home
          </Link>
          <Link href="/login" className="text-blue-600 hover:text-blue-700 hover:underline">
            Back to Login
          </Link>
          <Link href="/privacy-policy" className="text-gray-500 hover:text-gray-700 hover:underline">
            Privacy Policy
          </Link>
          <Link href="/terms-of-service" className="text-gray-500 hover:text-gray-700 hover:underline">
            Terms of Service
          </Link>
          <Link href="/data-deletion" className="text-gray-500 hover:text-gray-700 hover:underline">
            Data Deletion
          </Link>
        </div>

        <p className="mt-8 text-xs text-gray-400">
          &copy; {new Date().getFullYear()} Serapod2U. All rights reserved.
        </p>
      </main>
    </div>
  )
}

/** Titled content section used inside a legal page. */
export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-900">{heading}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}
