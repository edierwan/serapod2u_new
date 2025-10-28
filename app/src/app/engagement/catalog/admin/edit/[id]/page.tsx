import { EngagementShell } from '@/components/engagement/EngagementShell'
import { AdminRewardEditor } from '@/components/engagement/catalog/AdminRewardEditor'
import { getServerUserProfile } from '@/lib/server/get-user-profile'

type PageProps = {
  params: {
    id: string
  }
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function EngagementCatalogAdminEditPage({ params }: PageProps) {
  const userProfile = await getServerUserProfile()

  return (
    <EngagementShell userProfile={userProfile} activeView="point-catalog-admin">
      <AdminRewardEditor userProfile={userProfile} rewardId={params.id} mode="edit" />
    </EngagementShell>
  )
}
