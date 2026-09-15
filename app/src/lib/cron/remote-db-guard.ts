import { NextResponse } from 'next/server'

/**
 * Guard against a developer's local process running background workers
 * against a shared remote database.
 *
 * Why: app/.env.local points `next dev` at the staging Supabase. A worker run
 * from that process writes real staging data, and anything it renders uses the
 * local NEXT_PUBLIC_APP_URL - which is how staging QR Excel files ended up with
 * http://localhost:3000 tracking URLs (ORD26000029, ORD26000098).
 *
 * A worker is BLOCKED when the database is remote AND the process looks local:
 *   - NODE_ENV is not 'production' (next dev, tests pointed at a remote DB), or
 *   - the configured app URL is a loopback host (e.g. `next start` locally).
 * Deployed staging/production run NODE_ENV=production with their real domain,
 * and a local Supabase (localhost/127.0.0.1) is never blocked, so ordinary
 * local development is unaffected.
 *
 * ALLOW_REMOTE_DB_WORKERS_FROM_LOCAL=true is the explicit override.
 */

export const REMOTE_DB_WORKER_OVERRIDE_ENV = 'ALLOW_REMOTE_DB_WORKERS_FROM_LOCAL'

export interface RemoteDbGuardInput {
  nodeEnv?: string
  supabaseUrl?: string
  appUrl?: string
  override?: string
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', 'host.docker.internal'])

function hostOf(rawUrl: string | undefined): string | null {
  const trimmed = rawUrl?.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost') || host.startsWith('127.')
}

function isTruthy(raw: string | undefined): boolean {
  const value = String(raw ?? '').trim().toLowerCase()
  return value !== '' && !['0', 'false', 'off', 'no'].includes(value)
}

/**
 * Reads the build-inlined NEXT_PUBLIC_* values by default (literal
 * process.env access), matching what the Supabase clients actually use.
 */
function currentInput(): RemoteDbGuardInput {
  return {
    nodeEnv: process.env.NODE_ENV,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    override: process.env.ALLOW_REMOTE_DB_WORKERS_FROM_LOCAL,
  }
}

/** Returns a human-readable reason when workers must not run, otherwise null. */
export function remoteDbWorkerBlockReason(input: RemoteDbGuardInput = currentInput()): string | null {
  const dbHost = hostOf(input.supabaseUrl)
  // Unknown or local database: nothing shared is at risk.
  if (!dbHost || isLoopbackHost(dbHost)) return null
  if (isTruthy(input.override)) return null

  const appHost = hostOf(input.appUrl)
  if (input.nodeEnv !== 'production') {
    return `NODE_ENV=${input.nodeEnv ?? 'unset'} process is connected to remote database ${dbHost}`
  }
  if (appHost && isLoopbackHost(appHost)) {
    return `app URL host ${appHost} is local but the database ${dbHost} is remote`
  }
  return null
}

/** 409 for a blocked worker, or null when it may run. */
export function remoteDbWorkerBlockedResponse(workerName: string, input?: RemoteDbGuardInput): NextResponse | null {
  const reason = remoteDbWorkerBlockReason(input)
  if (!reason) return null

  console.warn(`[RemoteDbGuard] ${workerName}: refused - ${reason}. Set ${REMOTE_DB_WORKER_OVERRIDE_ENV}=true to override.`)
  return NextResponse.json(
    {
      error: 'Background worker disabled for a local process connected to a remote database',
      details: `${reason}. Set ${REMOTE_DB_WORKER_OVERRIDE_ENV}=true only if this is intentional.`,
      status: 'REMOTE_DB_WORKER_BLOCKED',
    },
    { status: 409 }
  )
}
