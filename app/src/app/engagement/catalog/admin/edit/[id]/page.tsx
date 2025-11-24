import { EngagementShell } from '@/components/engagement/EngagementShell'
import { AdminRewardEditor } from '@/components/engagement/catalog/AdminRewardEditor'
import { getServerUserProfile } from '@/lib/server/get-user-profile'

type PageProps = {
  params: Promise<{
    id: string
  }>
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function EngagementCatalogAdminEditPage({ params }: PageProps) {
  const userProfile = await getServerUserProfile()
  const { id } = await params

  return (
    <EngagementShell userProfile={userProfile} activeView="point-catalog-admin">
      <AdminRewardEditor userProfile={userProfile} rewardId={id} mode="edit" />
    </EngagementShell>
  )
}
