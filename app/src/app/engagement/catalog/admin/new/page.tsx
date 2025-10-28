import { EngagementShell } from '@/components/engagement/EngagementShell'
import { AdminRewardEditor } from '@/components/engagement/catalog/AdminRewardEditor'
import { getServerUserProfile } from '@/lib/server/get-user-profile'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function EngagementCatalogAdminNewPage() {
  const userProfile = await getServerUserProfile()

  return (
    <EngagementShell userProfile={userProfile} activeView="point-catalog-admin-new">
      <AdminRewardEditor userProfile={userProfile} mode="create" />
    </EngagementShell>
  )
}
