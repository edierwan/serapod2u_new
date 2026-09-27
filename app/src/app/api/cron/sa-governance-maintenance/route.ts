import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCronAuth } from '@/lib/cron/auth'
import { WORKER_NAMES, withWorkerLease } from '@/lib/cron/lease'

/**
 * CRON: Security & Access governance maintenance (service identity
 * 'sa-governance-maintenance').
 *
 * - public.sa_governance_maintenance(): expires time-boxed manual/request
 *   assignments, delegations, SoD mitigations and stale access requests.
 * - Once per UTC day (first run after 02:00): public.sa_lifecycle_resync_all()
 *   re-derives Joiner/Mover/Leaver state for every enterprise identity so
 *   contract end dates and any missed trigger converge.
 * Takes no parameters; both functions are idempotent and service-only.
 */
const WORKER = WORKER_NAMES.saGovernanceMaintenance

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request, WORKER)
  if (unauthorized) return unauthorized
  const supabase = createAdminClient()
  const outcome = await withWorkerLease(supabase, WORKER, () => run(supabase))
  return outcome.status === 'ran' ? outcome.result : outcome.response
}

async function run(supabase: ReturnType<typeof createAdminClient>): Promise<NextResponse> {
  const admin = supabase as any
  const { data, error } = await admin.rpc('sa_governance_maintenance')
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      return NextResponse.json({ status: 'GOVERNANCE_NOT_INSTALLED' })
    }
    console.error(`[${WORKER}] maintenance failed`, { code: error.code })
    return NextResponse.json({ status: 'FAILED' }, { status: 500 })
  }
  let resync: unknown = null
  const now = new Date()
  if (now.getUTCHours() === 2 && now.getUTCMinutes() < 15) {
    const result = await admin.rpc('sa_lifecycle_resync_all')
    if (result.error) console.error(`[${WORKER}] lifecycle resync failed`, { code: result.error.code })
    resync = result.error ? 'FAILED' : result.data
  }
  await admin.rpc('sa_touch_service_identity', { p_identity_key: 'sa-governance-maintenance' })
  return NextResponse.json({ status: 'OK', maintenance: data, lifecycleResync: resync })
}
