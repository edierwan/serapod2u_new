import { EngagementShell } from '@/components/engagement/EngagementShell'
import { AdminCatalogPage } from '@/components/engagement/catalog/AdminCatalogPage'
import { getServerUserProfile } from '@/lib/server/get-user-profile'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function EngagementCatalogAdminPage() {
  const userProfile = await getServerUserProfile()

  return (
    <EngagementShell userProfile={userProfile} activeView="point-catalog-admin">
      <AdminCatalogPage userProfile={userProfile} />
    </EngagementShell>
  )
}
