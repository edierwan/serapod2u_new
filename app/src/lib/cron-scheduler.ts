import cron from 'node-cron'

/**
 * Internal Cron Scheduler for Coolify / self-hosted deployments.
 *
 * Replaces vercel.json cron definitions. Each job sends an HTTP GET
 * to the existing /api/cron/* endpoints with the CRON_SECRET header,
 * exactly as Vercel Cron would.
 *
 * The schedule runs inside the long‑lived Next.js Node process,
 * so it only works on persistent servers (Coolify, VPS, Docker) —
 * NOT on serverless (Vercel, AWS Lambda).
 */

const CRON_JOBS = [
  { path: '/api/cron/qr-reverse-worker',            schedule: '*/1 * * * *' },
  { path: '/api/cron/qr-generation-worker',          schedule: '*/1 * * * *' },
  { path: '/api/cron/manufacturer-packing-worker',   schedule: '*/1 * * * *' },
  { path: '/api/cron/notification-outbox-worker',    schedule: '*/1 * * * *' },
]

function getBaseUrl(): string {
  // Prefer explicit config, fall back to localhost
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    `http://localhost:${process.env.PORT || 3000}`
  )
}

async function triggerJob(path: string): Promise<void> {
  const url = `${getBaseUrl()}${path}`
  const secret = process.env.CRON_SECRET || process.env.WORKER_SECRET

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      signal: AbortSignal.timeout(55_000), // 55s timeout (jobs run every 60s)
    })

    if (!res.ok) {
      console.warn(`[Cron] ${path} responded ${res.status}`)
    }
  } catch (err: any) {
    // Don't crash the scheduler on transient failures
    if (err.name === 'TimeoutError') {
      console.warn(`[Cron] ${path} timed out`)
    } else {
      console.warn(`[Cron] ${path} error: ${err.message}`)
    }
  }
}

let started = false

export function startCronScheduler(): void {
  if (started) return
  started = true

  console.log('[Cron] Starting internal cron scheduler (Coolify mode)')
  console.log(`[Cron] Base URL: ${getBaseUrl()}`)
  console.log(`[Cron] CRON_SECRET: ${process.env.CRON_SECRET ? 'set' : 'NOT SET'}`)

  for (const job of CRON_JOBS) {
    cron.schedule(job.schedule, () => {
      triggerJob(job.path)
    })
    console.log(`[Cron] Scheduled: ${job.path} → ${job.schedule}`)
  }
}
