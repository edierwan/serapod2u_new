import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Strict authentication for internal cron worker routes.
 *
 * Every cron worker MUST require `Authorization: Bearer <CRON_SECRET>`.
 * There is deliberately NO "no header means manual trigger, carry on" path:
 * that bypass allowed anonymous execution of production workers.
 *
 * Failure modes are all 401 and never echo the supplied credential.
 */

/** Resolve the configured cron credential. WORKER_SECRET is kept for backwards compatibility. */
export function getCronSecret(): string | undefined {
  const secret = process.env.CRON_SECRET || process.env.WORKER_SECRET
  return secret && secret.length > 0 ? secret : undefined
}

/** Length-safe constant-time comparison. Never short-circuits on content. */
function safeEqual(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied, 'utf8')
  const b = Buffer.from(expected, 'utf8')

  if (a.length !== b.length) {
    // Compare against self so the work done does not depend on the secret's
    // content; the length difference itself is already decisive.
    timingSafeEqual(a, a)
    return false
  }

  return timingSafeEqual(a, b)
}

/** 401 helper. `reason` is for our logs only - never include the supplied token. */
function unauthorized(worker: string, reason: string): NextResponse {
  console.warn(`[CronAuth] ${worker}: rejected request (${reason})`)
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

/**
 * Returns `null` when the caller is authorized, or a 401 response when it is not.
 *
 * Development behaviour is explicit rather than implicit: a request is only
 * allowed without a credential when NODE_ENV !== 'production' AND no secret is
 * configured at all. If a secret is configured it is always enforced, in every
 * environment. Production without a configured secret fails CLOSED.
 */
export function requireCronAuth(request: NextRequest, workerName: string): NextResponse | null {
  const secret = getCronSecret()
  const isProduction = process.env.NODE_ENV === 'production'

  if (!secret) {
    if (isProduction) {
      // Misconfiguration must never mean "open to the world".
      console.error(`[CronAuth] ${workerName}: CRON_SECRET is not configured - refusing request`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.warn(
      `[CronAuth] ${workerName}: no CRON_SECRET configured and NODE_ENV is not production - allowing unauthenticated run`
    )
    return null
  }

  const header = request.headers.get('authorization')
  if (!header) {
    return unauthorized(workerName, 'missing Authorization header')
  }

  const separatorIndex = header.indexOf(' ')
  if (separatorIndex < 0) {
    return unauthorized(workerName, 'malformed Authorization header')
  }

  const scheme = header.slice(0, separatorIndex)
  const token = header.slice(separatorIndex + 1).trim()

  if (scheme.toLowerCase() !== 'bearer' || token.length === 0) {
    return unauthorized(workerName, 'unsupported Authorization scheme')
  }

  if (!safeEqual(token, secret)) {
    return unauthorized(workerName, 'invalid credentials')
  }

  return null
}

/**
 * Dual-path guard for workers that are ALSO triggered from the authenticated UI.
 *
 * `warehouse-receiving-worker` is fetched by the warehouse dashboard from the
 * browser, which cannot send CRON_SECRET (that would ship the credential to the
 * client). Requiring strict cron auth there would break the receiving flow, so
 * this accepts EITHER:
 *   - a valid `Authorization: Bearer <CRON_SECRET>` (server/cron caller), or
 *   - a signed-in Supabase session (same-origin fetch sends the cookies)
 *
 * Anonymous callers are still rejected.
 */
export async function requireCronOrSessionAuth(
  request: NextRequest,
  workerName: string
): Promise<NextResponse | null> {
  const secret = getCronSecret()
  const header = request.headers.get('authorization')

  // Path 1: a correct cron credential is sufficient on its own.
  if (secret && header) {
    const separatorIndex = header.indexOf(' ')
    if (separatorIndex > 0) {
      const scheme = header.slice(0, separatorIndex)
      const token = header.slice(separatorIndex + 1).trim()
      if (scheme.toLowerCase() === 'bearer' && token.length > 0 && safeEqual(token, secret)) {
        return null
      }
    }
  }

  // Path 2: an authenticated user session.
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (!error && user) return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[CronAuth] ${workerName}: session check failed (${message})`)
  }

  return unauthorized(workerName, 'no valid cron credential and no authenticated session')
}
