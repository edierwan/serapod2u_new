import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCronAuth } from '@/lib/cron/auth'
import { WORKER_NAMES, withWorkerLease } from '@/lib/cron/lease'
import { runQRBatchGeneration } from '@/lib/qr-batch-generation'

/**
 * CRON: /api/cron/qr-generation-worker
 * Background worker to process queued QR batches (global queue, oldest first).
 * Runs every minute via internal cron scheduler.
 * Uses admin client (service_role) since cron has no user session.
 *
 * Deliberately CRON_SECRET-only. The dashboard must not call this: a session
 * here could drive any organization's batch. Users go through
 * POST /api/qr-batches/process, which is scoped to a batch they own.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Keep each run short to avoid timeouts

const WORKER = WORKER_NAMES.qrGeneration

export async function GET(request: NextRequest) {
  // Strict cron auth: a missing/!bearer/wrong credential is always 401.
  const unauthorized = requireCronAuth(request, WORKER)
  if (unauthorized) return unauthorized

  const supabase = createAdminClient()
  const notificationBaseUrl = request.nextUrl.origin
  const outcome = await withWorkerLease(supabase, WORKER, () =>
    runQRBatchGeneration(supabase, { notificationBaseUrl })
  )
  return outcome.status === 'ran' ? outcome.result : outcome.response
}
