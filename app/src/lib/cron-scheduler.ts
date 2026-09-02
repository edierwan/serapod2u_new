import cron from 'node-cron'
import { randomUUID } from 'node:crypto'

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
  { path: '/api/cron/qr-reverse-worker', schedule: '*/1 * * * *' },
  { path: '/api/cron/qr-generation-worker', schedule: '*/1 * * * *' },
  { path: '/api/cron/manufacturer-packing-worker', schedule: '*/1 * * * *' },
  { path: '/api/cron/notification-outbox-worker', schedule: '*/1 * * * *' },
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
  const headers: Record<string, string> = secret ? { Authorization: `Bearer ${secret}` } : {}
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

async function triggerJob(path: string, expression: string): Promise<void> {
  // Secondary safety net; see claimDispatchSlot.
  if (!claimDispatchSlot(path, expression, Date.now())) return

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

/**
 * PROCESS-GLOBAL scheduler registry.
 *
 * Root cause this exists for: the Next.js standalone production runtime
 * evaluates this module TWICE inside the same Node process. Each evaluation
 * previously got its own `let started = false` and registered its own four
 * node-cron tasks, so every worker was invoked ~2x/minute. Confirmed in
 * production by two distinct scheduler instance ids arriving on authenticated
 * internal cron requests while only one container and one PID existed.
 *
 * Module-scoped state (let/const/Set/Map) is duplicated along with the module
 * and therefore CANNOT own this. The registry is hung off globalThis under a
 * Symbol.for key, which is shared across every evaluation in the process.
 */
const REGISTRY_KEY = Symbol.for('serapod2u.cron.scheduler.registry')

interface CronSchedulerRegistry {
  started: boolean
  schedulerInstanceId: string
  registeredPaths: Set<string>
  /** path -> cron period index already dispatched (secondary guard) */
  lastDispatchPeriod: Map<string, number>
}

type RegistryHolder = typeof globalThis & {
  [REGISTRY_KEY]?: CronSchedulerRegistry
}

function getRegistry(): CronSchedulerRegistry {
  const holder = globalThis as RegistryHolder
  if (!holder[REGISTRY_KEY]) {
    holder[REGISTRY_KEY] = {
      started: false,
      schedulerInstanceId: randomUUID().slice(0, 8),
      registeredPaths: new Set<string>(),
      lastDispatchPeriod: new Map<string, number>(),
    }
  }
  return holder[REGISTRY_KEY]
}

/** Exported for tests only. */
export function __resetCronRegistryForTests(): void {
  delete (globalThis as RegistryHolder)[REGISTRY_KEY]
}

/** Exported for tests only. */
export function __getCronRegistryForTests(): CronSchedulerRegistry {
  return getRegistry()
}

/** A 5-field expression is minute-granular; a 6-field one carries seconds. */
export function isMinuteGranular(expression: string): boolean {
  return expression.trim().split(/\s+/).length === 5
}

/**
 * Secondary safety net, retained deliberately.
 *
 * Preventing duplicate registration is the primary fix. This additionally caps
 * a minute-granular path at one dispatch per minute per PROCESS, so any future
 * mechanism that manages to call triggerJob twice in a tick still cannot double
 * dispatch. Its state lives in the same global registry - a module-local Map
 * would be duplicated exactly like the state that caused the original bug.
 *
 * Sub-minute (6-field) schedules are never suppressed.
 */
export function claimDispatchSlot(path: string, expression: string, now: number): boolean {
  if (!isMinuteGranular(expression)) return true
  const registry = getRegistry()
  const period = Math.floor(now / 60_000)
  if (registry.lastDispatchPeriod.get(path) === period) return false
  registry.lastDispatchPeriod.set(path, period)
  return true
}

export function startCronScheduler(): void {
  const registry = getRegistry()

  if (registry.started) {
    // Reached when the runtime evaluates this module a second time. One concise
    // line, emitted at most once per extra evaluation - not per tick.
    console.warn(
      `[Cron] Duplicate scheduler initialization suppressed (owner=${registry.schedulerInstanceId})`
    )
    return
  }
  registry.started = true

  console.log('[Cron] Starting internal cron scheduler (Coolify mode)')
  console.log(`[Cron] Scheduler instance: ${registry.schedulerInstanceId}`)
  console.log(`[Cron] Base URL: ${getBaseUrl()}`)
  console.log(`[Cron] CRON_SECRET: ${process.env.CRON_SECRET ? 'set' : 'NOT SET'}`)

  for (const job of CRON_JOBS) {
    if (registry.registeredPaths.has(job.path)) {
      console.warn(`[Cron] ${job.path} already registered - skipping`)
      continue
    }
    registry.registeredPaths.add(job.path)

    cron.schedule(job.schedule, () => {
      triggerJob(job.path, job.schedule)
    })
    console.log(`[Cron] Scheduled: ${job.path} → ${job.schedule}`)
  }

  console.log(`[Cron] Registered ${registry.registeredPaths.size} worker route(s)`)
}
