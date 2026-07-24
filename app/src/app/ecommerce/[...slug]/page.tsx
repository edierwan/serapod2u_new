import DashboardContent from '@/components/dashboard/DashboardContent'
import { getEcommercePageContext } from '@/app/ecommerce/_lib'
import { resolveEcommerceSlug } from '@/modules/customer-growth/customerGrowthNav'

interface EcommerceSubPageProps {
  params: Promise<{ slug?: string[] }>
}

export default async function EcommerceSubPage({ params }: EcommerceSubPageProps) {
  const { userProfile, canViewEcommerce } = await getEcommercePageContext()
  const { slug = [] } = await params
  const initialView = resolveEcommerceSlug(slug)

  if (!canViewEcommerce) {
    return (
      <div className="p-8">
        <h2 className="text-xl font-semibold">Unauthorized</h2>
        <p>You do not have permission to view E-commerce management.</p>
      </div>
    )
  }

  return <DashboardContent userProfile={userProfile} initialView={initialView} />
}
