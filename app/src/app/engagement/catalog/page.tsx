import { EngagementShell } from '@/components/engagement/EngagementShell'
import { ShopCatalogPage } from '@/components/engagement/catalog/ShopCatalogPage'
import { getServerUserProfile } from '@/lib/server/get-user-profile'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function EngagementCatalogPage() {
  const userProfile = await getServerUserProfile()

  return (
    <EngagementShell userProfile={userProfile} activeView="point-catalog">
      <ShopCatalogPage userProfile={userProfile} />
    </EngagementShell>
  )
}
