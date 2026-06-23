import { EngagementShell } from '@/components/engagement/EngagementShell'
import { ShopCatalogPage } from '@/components/engagement/catalog/ShopCatalogPage'
import { LoyaltyProgramSelector } from '@/components/engagement/catalog/LoyaltyProgramSelector'
import { EllbowShopCatalogPage } from '@/components/engagement/catalog/EllbowShopCatalogPage'
import { getServerUserProfile } from '@/lib/server/get-user-profile'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PageProps = { searchParams: Promise<{ program?: string }> }

export default async function EngagementCatalogPage({ searchParams }: PageProps) {
  const userProfile = await getServerUserProfile()
  const { program } = await searchParams
  const isEllbow = program === 'ellbow'

  return (
    <EngagementShell userProfile={userProfile} activeView="point-catalog">
      <LoyaltyProgramSelector program={isEllbow ? 'ellbow' : 'cellera'} shopView />
      {isEllbow ? <EllbowShopCatalogPage /> : <ShopCatalogPage userProfile={userProfile} />}
    </EngagementShell>
  )
}
