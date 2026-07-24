import DashboardContent from '@/components/dashboard/DashboardContent'
import { getLoyaltyPageContext } from '@/app/loyalty/_lib'
import { resolveLoyaltySlug } from '@/modules/loyalty/loyaltyNav'

interface LoyaltySubPageProps {
  params: Promise<{ slug?: string[] }>
}

export default async function LoyaltySubPage({ params }: LoyaltySubPageProps) {
  const { userProfile, canViewLoyalty } = await getLoyaltyPageContext()
  const { slug = [] } = await params
  const initialView = resolveLoyaltySlug(slug)

  if (!canViewLoyalty) {
    return (
      <div className="p-8">
        <h2 className="text-xl font-semibold">Unauthorized</h2>
        <p>You do not have permission to view the Loyalty module.</p>
      </div>
    )
  }

  return <DashboardContent userProfile={userProfile} initialView={initialView} />
}
