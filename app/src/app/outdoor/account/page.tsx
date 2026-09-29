import OutdoorAccountClient from '@/components/outdoor/OutdoorAccountClient'

export const metadata = { title: 'Account' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function OutdoorAccountPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const tab = params.tab === 'orders' ? 'orders' : 'profile'
  const pendingRef = typeof params.pending === 'string' ? params.pending : ''
  return <OutdoorAccountClient initialTab={tab} pendingRef={pendingRef} />
}
