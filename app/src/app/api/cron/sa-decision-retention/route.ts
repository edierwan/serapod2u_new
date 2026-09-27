import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCronAuth } from '@/lib/cron/auth'
import { WORKER_NAMES, withWorkerLease } from '@/lib/cron/lease'

/**
 * CRON: Security & Access authorization-decision retention.
 *
 * Calls the service-only public.sa_purge_ordinary_shadow_decisions(), which
 * removes only ORDINARY_SHADOW decisions older than 90 days and records every
 * run in sa_retention_runs. The endpoint takes no parameters: it cannot change
 * the window, the class, or the per-batch bound. Protected classes
 * (ENFORCED_DECISION, SECURITY_SENSITIVE, POLICY_ERROR, UNCLASSIFIED) are
 * refused by the database itself.
 */
const WORKER = WORKER_NAMES.saDecisionRetention
const BATCH_LIMIT = 5000
const MAX_BATCHES_PER_RUN = 10

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const unauthorized = requireCronAuth(request, WORKER)
  if (unauthorized) return unauthorized

  const supabase = createAdminClient()
  const outcome = await withWorkerLease(supabase, WORKER, () => runRetention(supabase))
  return outcome.status === 'ran' ? outcome.result : outcome.response
}

async function runRetention(supabase: ReturnType<typeof createAdminClient>): Promise<NextResponse> {
  let deleted = 0
  let batches = 0
  let moreRemaining = true
  while (moreRemaining && batches < MAX_BATCHES_PER_RUN) {
    const { data, error } = await (supabase as any).rpc('sa_purge_ordinary_shadow_decisions', { p_batch_limit: BATCH_LIMIT })
    if (error) {
      // Environment without the readiness migration: nothing to retain yet.
      if (error.code === 'PGRST202' || error.code === '42883') {
        console.warn(`[${WORKER}] retention function not installed; skipping`)
        return NextResponse.json({ status: 'RETENTION_NOT_INSTALLED', deleted: 0 })
      }
      console.error(`[${WORKER}] purge failed`, { code: error.code, batches, deleted })
      return NextResponse.json({ status: 'FAILED', deleted, batches }, { status: 500 })
    }
    batches += 1
    if (data?.status !== 'completed') break // concurrent run holds the purge lock
    deleted += Number(data.deleted || 0)
    moreRemaining = data.more_remaining === true
  }
  console.log(`[${WORKER}] deleted ${deleted} ordinary shadow decision(s) in ${batches} batch(es)`)
  return NextResponse.json({ status: 'OK', deleted, batches, moreRemaining })
}
