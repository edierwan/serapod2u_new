import { getProductDetail } from '@/lib/storefront/products'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft, Package } from 'lucide-react'
import Link from 'next/link'
import ProductDetailClient from '@/components/storefront/ProductDetailClient'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const product = await getProductDetail(id)
  return {
    title: product?.product_name ?? 'Product Not Found',
    description: product?.short_description ?? undefined,
  }
}

export default async function ProductDetailPage({ params }: PageProps) {
  const { id } = await params
  const product = await getProductDetail(id)

  if (!product) return notFound()

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <Link
        href="/store/products"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to products
      </Link>

      <ProductDetailClient product={product} />
    </div>
  )
}
