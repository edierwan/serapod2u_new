import { notFound } from 'next/navigation'
import { getOutdoorProductDetail } from '@/lib/outdoor/catalog'
import OutdoorProductDetailClient from '@/components/outdoor/OutdoorProductDetailClient'

export const dynamic = 'force-dynamic'

type Params = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params
  const product = await getOutdoorProductDetail(id)
  return { title: product?.product_name || 'Product' }
}

export default async function OutdoorProductPage({ params }: { params: Params }) {
  const { id } = await params
  const product = await getOutdoorProductDetail(id)
  if (!product) notFound()
  return <OutdoorProductDetailClient product={product} />
}
