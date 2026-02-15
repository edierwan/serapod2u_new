import Link from 'next/link'
import { XCircle, ShoppingBag, RefreshCw } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Payment Failed' }

interface PageProps {
  searchParams: Promise<{ ref?: string; reason?: string }>
}

export default async function OrderFailedPage({ searchParams }: PageProps) {
  const params = await searchParams
  const orderRef = params.ref || '—'
  const reason = params.reason || 'The payment could not be processed.'

  return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center">
      <div className="mx-auto mb-6 h-20 w-20 rounded-full bg-red-50 flex items-center justify-center ring-8 ring-red-50/50">
        <XCircle className="h-10 w-10 text-red-500" />
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">Payment Failed</h1>
      <p className="text-gray-500 text-sm mb-2 leading-relaxed">
        Order <span className="font-semibold text-gray-700">{orderRef}</span>
      </p>
      <p className="text-gray-500 text-sm mb-6">{reason}</p>

      <div className="inline-flex flex-col sm:flex-row gap-3">
        <Link
          href="/store/checkout"
          className="inline-flex items-center gap-2 h-11 px-6 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition"
        >
          <RefreshCw className="h-4 w-4" />
          Try Again
        </Link>
        <Link
          href="/store/products"
          className="inline-flex items-center gap-2 h-11 px-6 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition"
        >
          <ShoppingBag className="h-4 w-4" />
          Browse Products
        </Link>
      </div>
    </div>
  )
}
