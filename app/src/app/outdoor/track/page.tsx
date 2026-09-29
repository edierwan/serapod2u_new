import { redirect } from 'next/navigation'
import OutdoorTrackClient from '@/components/outdoor/OutdoorTrackClient'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Track Order' }
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function OutdoorTrackPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const order = typeof params.order === 'string' ? params.order : typeof params.ref === 'string' ? params.ref : ''
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const next = order ? `/outdoor/track?order=${encodeURIComponent(order)}` : '/outdoor/track'
    redirect(`/outdoor/login?next=${encodeURIComponent(next)}`)
  }
  return <OutdoorTrackClient initialOrderRef={order} />
}
