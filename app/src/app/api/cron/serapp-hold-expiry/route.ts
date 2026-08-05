import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { expireSerappOrderHold } from '@/lib/serapp/hold-service'

/**
 * CRON: expire Serapp 1-hour holds that were not warehouse-accepted.
 * Auth: Authorization Bearer CRON_SECRET / WORKER_SECRET
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorize(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET || process.env.WORKER_SECRET
  if (!cronSecret) {
    // Allow in local/dev when secret is unset, matching other workers' pragmatism.
    return process.env.NODE_ENV !== 'production'
  }
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return token === cronSecret
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    const now = new Date()

    const { data: dueHolds, error } = await admin
      .from('serapp_order_holds')
      .select('id, order_id, status, expires_at')
      .eq('status', 'active')
      .lte('expires_at', now.toISOString())
      .order('expires_at', { ascending: true })
      .limit(50)

    if (error) {
      console.error('[serapp-hold-expiry] query failed', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const results: Array<{ orderId: string; expired: boolean; reason: string }> = []
    for (const hold of dueHolds || []) {
      try {
        const outcome = await expireSerappOrderHold(admin, hold, now)
        results.push({
          orderId: hold.order_id,
          expired: outcome.expired,
          reason: outcome.reason,
        })
      } catch (holdError) {
        console.error('[serapp-hold-expiry] hold failed', hold.id, holdError)
        results.push({
          orderId: hold.order_id,
          expired: false,
          reason: holdError instanceof Error ? holdError.message : 'failed',
        })
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: (dueHolds || []).length,
      expired: results.filter(result => result.expired).length,
      results,
    })
  } catch (error) {
    console.error('[serapp-hold-expiry]', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Expiry worker failed',
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
