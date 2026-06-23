import { EngagementShell } from '@/components/engagement/EngagementShell'
import { AdminRewardEditor } from '@/components/engagement/catalog/AdminRewardEditor'
import { EllbowRewardEditor } from '@/components/engagement/catalog/EllbowRewardEditor'
import { LoyaltyProgramSelector } from '@/components/engagement/catalog/LoyaltyProgramSelector'
import { getServerUserProfile } from '@/lib/server/get-user-profile'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PageProps = { searchParams: Promise<{ program?: string }> }

export default async function EngagementCatalogAdminNewPage({ searchParams }: PageProps) {
  const userProfile = await getServerUserProfile()
  const { program } = await searchParams
  const isEllbow = program === 'ellbow'

  return (
    <EngagementShell userProfile={userProfile} activeView="point-catalog-admin-new">
      {isEllbow ? (
        <><LoyaltyProgramSelector program="ellbow" /><EllbowRewardEditor mode="create" /></>
      ) : <AdminRewardEditor userProfile={userProfile} mode="create" />}
    </EngagementShell>
  )
}
