import { EngagementShell } from '@/components/engagement/EngagementShell'
import { AdminCatalogPage } from '@/components/engagement/catalog/AdminCatalogPage'
import { EllbowAdminPage } from '@/components/engagement/catalog/EllbowAdminPage'
import { LoyaltyProgramSelector } from '@/components/engagement/catalog/LoyaltyProgramSelector'
import { getServerUserProfile } from '@/lib/server/get-user-profile'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PageProps = { searchParams: Promise<{ program?: string }> }

export default async function EngagementCatalogAdminPage({ searchParams }: PageProps) {
  const userProfile = await getServerUserProfile()
  const { program } = await searchParams
  const isEllbow = program === 'ellbow'

  return (
    <EngagementShell userProfile={userProfile} activeView="point-catalog-admin">
      <LoyaltyProgramSelector program={isEllbow ? 'ellbow' : 'cellera'} />
      {isEllbow ? <EllbowAdminPage /> : <AdminCatalogPage userProfile={userProfile} />}
    </EngagementShell>
  )
}
