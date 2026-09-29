import { notFound } from 'next/navigation'
import { getOutdoorCategoryNav, getOutdoorProductDetail } from '@/lib/outdoor/catalog'
import OutdoorCategoryNav from '@/components/outdoor/OutdoorCategoryNav'
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
  const [product, circles] = await Promise.all([
    getOutdoorProductDetail(id),
    getOutdoorCategoryNav(),
  ])
  if (!product) notFound()
  return (
    <>
      <OutdoorCategoryNav items={circles} />
      <OutdoorProductDetailClient product={product} />
    </>
  )
}
