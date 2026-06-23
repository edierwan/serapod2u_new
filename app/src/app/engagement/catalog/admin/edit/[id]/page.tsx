import { EngagementShell } from '@/components/engagement/EngagementShell'
import { AdminRewardEditor } from '@/components/engagement/catalog/AdminRewardEditor'
import { EllbowRewardEditor } from '@/components/engagement/catalog/EllbowRewardEditor'
import { LoyaltyProgramSelector } from '@/components/engagement/catalog/LoyaltyProgramSelector'
import { getServerUserProfile } from '@/lib/server/get-user-profile'

type PageProps = {
  params: Promise<{
    id: string
  }>
  searchParams: Promise<{ program?: string }>
}

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function EngagementCatalogAdminEditPage({ params, searchParams }: PageProps) {
  const userProfile = await getServerUserProfile()
  const { id } = await params
  const { program } = await searchParams
  const isEllbow = program === 'ellbow'

  return (
    <EngagementShell userProfile={userProfile} activeView="point-catalog-admin">
      {isEllbow ? (
        <><LoyaltyProgramSelector program="ellbow" /><EllbowRewardEditor rewardId={id} mode="edit" /></>
      ) : <AdminRewardEditor userProfile={userProfile} rewardId={id} mode="edit" />}
    </EngagementShell>
  )
}
