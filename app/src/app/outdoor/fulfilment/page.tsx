import { Suspense } from 'react'
import OutdoorFulfilmentClient from '@/components/outdoor/OutdoorFulfilmentClient'

export const metadata = {
  title: 'Fulfilment',
}

export default function OutdoorFulfilmentPage() {
  return (
    <Suspense fallback={<p className="px-5 py-16 text-sm text-[var(--out-muted)]">Loading…</p>}>
      <OutdoorFulfilmentClient />
    </Suspense>
  )
}
