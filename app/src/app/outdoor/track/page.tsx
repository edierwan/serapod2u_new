import OutdoorTrackClient from '@/components/outdoor/OutdoorTrackClient'

export const metadata = { title: 'Track Order' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function OutdoorTrackPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const order = typeof params.order === 'string' ? params.order : typeof params.ref === 'string' ? params.ref : ''
  return <OutdoorTrackClient initialOrderRef={order} />
}
