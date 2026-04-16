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

function normalizeBaseUrl(rawUrl: string): string {
  const withProtocol = rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`
  const parsed = new URL(withProtocol)

  if (parsed.hostname.startsWith('www.')) {
    parsed.hostname = parsed.hostname.slice(4)
  }

  parsed.pathname = ''
  parsed.search = ''
  parsed.hash = ''

  return parsed.toString().replace(/\/$/, '')
}

function getBaseUrl(): string {
  const coolifyHost = process.env.COOLIFY_FQDN
    ?.split(',')
    .map((value) => value.trim())
    .find(Boolean)

  const configuredUrl =
    process.env.INTERNAL_CRON_BASE_URL ||
    coolifyHost ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL

  if (configuredUrl) {
    return normalizeBaseUrl(configuredUrl)
  }

  return `http://localhost:${process.env.PORT || 3000}`
}

async function fetchCronEndpoint(url: string, secret?: string): Promise<Response> {
  const headers = secret ? { Authorization: `Bearer ${secret}` } : {}
  const response = await fetch(url, {
    method: 'GET',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(55_000),
  })

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (location) {
      const redirectedUrl = new URL(location, url).toString()
      return fetch(redirectedUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(55_000),
      })
    }
  }

  return response
}

async function triggerJob(path: string): Promise<void> {
  const url = `${getBaseUrl()}${path}`
  const secret = process.env.CRON_SECRET || process.env.WORKER_SECRET

  try {
    const res = await fetchCronEndpoint(url, secret)

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
