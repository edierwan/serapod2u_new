/**
 * POST /api/settings/notifications/sms-activity/refresh-status
 *
 * Explicit, user-triggered "check gateway now" action for the SMS Activity monitor.
 *
 * This is intentionally a separate endpoint from GET /sms-activity: that endpoint must
 * always return instantly from the database (see the note in ../route.ts). This one is
 * the only place that talks to the local SMS gateway on demand, and it is bounded so a
 * dead/slow gateway can never hang the request: refreshOpenSmsStatuses() checks messages
 * with limited concurrency and gives up after a fixed wall-clock budget, returning
 * whatever it managed to check so far (checks already in flight keep running and still
 * update the DB in the background; the HTTP response just doesn't wait for them).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canViewSmsMonitor } from '@/lib/notifications/smsMonitorAccess'
import { refreshOpenSmsStatuses } from '@/lib/notifications/sms-send'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const REFRESH_LIMIT = 20
const REFRESH_CONCURRENCY = 5
const REFRESH_TIMEOUT_MS = 8_000

export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!await canViewSmsMonitor(supabase, user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const admin = createAdminClient()
    const result = await refreshOpenSmsStatuses(admin, REFRESH_LIMIT, {
      concurrency: REFRESH_CONCURRENCY,
      overallTimeoutMs: REFRESH_TIMEOUT_MS,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error('[sms-activity:refresh-status]', error)
    return NextResponse.json({ error: error.message || 'Failed to refresh SMS status' }, { status: 500 })
  }
}
