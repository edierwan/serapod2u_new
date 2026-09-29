import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cron/auth'
import { remoteDbWorkerBlockedResponse } from '@/lib/cron/remote-db-guard'
import { expireUnpaidOrders } from '@/lib/storefront/expire-unpaid-orders'

/**
 * CRON: cancel Outdoor orders left unpaid for 24 hours and close their Stripe
 * payment page. Auth: Authorization Bearer CRON_SECRET.
 */
const WORKER = 'storefront-unpaid-expiry'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request, WORKER)
  if (unauthorized) return unauthorized
  const blocked = remoteDbWorkerBlockedResponse(WORKER)
  if (blocked) return blocked

  try {
    const results = await expireUnpaidOrders({ limit: 50 })
    const count = (outcome: string) => results.filter(result => result.outcome === outcome).length
    if (results.length) {
      console.log(`[${WORKER}] scanned ${results.length}: cancelled ${count('cancelled')}, paid ${count('paid')}, kept ${count('kept')}`)
    }
    return NextResponse.json({
      ok: true,
      scanned: results.length,
      cancelled: count('cancelled'),
      paid: count('paid'),
      kept: count('kept'),
      results,
    })
  } catch (error) {
    console.error(`[${WORKER}]`, error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Expiry worker failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
