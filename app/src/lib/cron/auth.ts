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

export interface CronOrSessionAuthOptions {
  /**
   * When set, the session path additionally requires an active user whose
   * organization's org_type_code is in this list. Cron callers are unaffected.
   */
  allowedOrgTypes?: readonly string[]
}

/** True only for a well-formed `Bearer <CRON_SECRET>` matching the configured secret. */
function hasValidCronCredential(request: NextRequest): boolean {
  const secret = getCronSecret()
  const header = request.headers.get('authorization')
  if (!secret || !header) return false

  const separatorIndex = header.indexOf(' ')
  if (separatorIndex <= 0) return false

  const scheme = header.slice(0, separatorIndex)
  const token = header.slice(separatorIndex + 1).trim()
  return scheme.toLowerCase() === 'bearer' && token.length > 0 && safeEqual(token, secret)
}

/**
 * Dual-path guard for workers that are ALSO triggered from the authenticated UI.
 *
 * `warehouse-receiving-worker` and `qr-generation-worker` are fetched by
 * dashboard views from the browser, which cannot send CRON_SECRET (that would
 * ship the credential to the client). Requiring strict cron auth there breaks
 * those flows, so this accepts EITHER:
 *   - a valid `Authorization: Bearer <CRON_SECRET>` (server/cron caller), or
 *   - a signed-in Supabase session (same-origin fetch sends the cookies),
 *     optionally restricted to `allowedOrgTypes` (403 otherwise)
 *
 * Anonymous callers are still rejected.
 */
export async function requireCronOrSessionAuth(
  request: NextRequest,
  workerName: string,
  options: CronOrSessionAuthOptions = {}
): Promise<NextResponse | null> {
  // Path 1: a correct cron credential is sufficient on its own.
  if (hasValidCronCredential(request)) return null

  // Path 2: an authenticated user session.
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (!error && user) {
      const allowedOrgTypes = options.allowedOrgTypes
      if (!allowedOrgTypes || allowedOrgTypes.length === 0) return null

      const { data: profile, error: profileError } = await (supabase as any)
        .from('users')
        .select('is_active, organizations:organization_id(org_type_code)')
        .eq('id', user.id)
        .single()

      const orgType = String(profile?.organizations?.org_type_code || '').toUpperCase()
      const allowed = allowedOrgTypes.map((type) => type.toUpperCase())
      if (!profileError && profile?.is_active !== false && allowed.includes(orgType)) return null

      console.warn(`[CronAuth] ${workerName}: session user's organization is not permitted to run this worker`)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[CronAuth] ${workerName}: session check failed (${message})`)
  }

  return unauthorized(workerName, 'no valid cron credential and no authenticated session')
}
