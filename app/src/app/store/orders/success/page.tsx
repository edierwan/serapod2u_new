import Link from 'next/link'
import { CheckCircle2, ShoppingBag, ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Order Confirmed' }

interface PageProps {
  searchParams: Promise<{ ref?: string }>
}

export default async function OrderSuccessPage({ searchParams }: PageProps) {
  const params = await searchParams
  const orderRef = params.ref || '—'

  return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center">
      {/* Animated check */}
      <div className="mx-auto mb-6 h-20 w-20 rounded-full bg-green-50 flex items-center justify-center ring-8 ring-green-50/50">
        <CheckCircle2 className="h-10 w-10 text-green-500" />
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">Thank you for your order!</h1>
      <p className="text-gray-500 text-sm mb-6 leading-relaxed">
        Your order <span className="font-semibold text-gray-700">{orderRef}</span> has been placed
        successfully. We&apos;ll send you an email confirmation and tracking details shortly.
      </p>

      <div className="inline-flex flex-col sm:flex-row gap-3">
        <Link
          href="/store/products"
          className="inline-flex items-center gap-2 h-11 px-6 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition"
        >
          <ShoppingBag className="h-4 w-4" />
          Continue Shopping
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 h-11 px-6 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition"
        >
          Go to Dashboard
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}
