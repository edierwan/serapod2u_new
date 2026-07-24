import DashboardContent from '@/components/dashboard/DashboardContent'
import { getMarketingPageContext } from '@/app/marketing/_lib'
import { resolveMarketingSlug } from '@/modules/marketing/marketingNav'

interface MarketingSubPageProps {
  params: Promise<{ slug?: string[] }>
}

export default async function MarketingSubPage({ params }: MarketingSubPageProps) {
  const { userProfile, canViewMarketing } = await getMarketingPageContext()
  const { slug = [] } = await params
  const initialView = resolveMarketingSlug(slug)

  if (!canViewMarketing) {
    return (
      <div className="p-8">
        <h2 className="text-xl font-semibold">Unauthorized</h2>
        <p>You do not have permission to view the Marketing module.</p>
      </div>
    )
  }

  return <DashboardContent userProfile={userProfile} initialView={initialView} />
}
