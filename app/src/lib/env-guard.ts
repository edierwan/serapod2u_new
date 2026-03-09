/**
 * Environment Safety Guard
 *
 * Prevents accidental production crossover in development deployments.
 * All checks are env-based — no refactoring required.
 *
 * Usage:
 *   import { envGuard } from '@/lib/env-guard'
 *   envGuard.assertDev()             // throws if running against production
 *   envGuard.isDev()                 // boolean check
 *   envGuard.cronAllowed()           // true only if cron should run in this env
 *   envGuard.getAppBaseUrl()         // returns correct base URL for environment
 */

// ── Production Supabase identifiers (never connect to these in dev) ────────
const PRODUCTION_SUPABASE_REFS = [
  'hsvmvmurvpqcdmxckhnz', // Serapod2u production project ref
]

const PRODUCTION_DOMAINS = [
  'www.serapod2u.com',
  'serapod2u.com',
  'app.serapod2u.com',
]

// ── Core detection ─────────────────────────────────────────────────────────

function getAppEnv(): string {
  return process.env.NEXT_PUBLIC_APP_ENV || 'development'
}

function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || ''
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || ''
}

/** Extract Supabase project ref from URL */
function extractSupabaseRef(url: string): string {
  // https://abcdefghijk.supabase.co → abcdefghijk
  const match = url.match(/https?:\/\/([^.]+)\.supabase\.co/)
  return match?.[1] || ''
}

// ── Public API ─────────────────────────────────────────────────────────────

export const envGuard = {
  /**
   * Returns true if the current environment is development
   */
  isDev(): boolean {
    return getAppEnv() === 'development'
  },

  /**
   * Returns true if the current environment is production
   */
  isProduction(): boolean {
    return getAppEnv() === 'production'
  },

  /**
   * Returns true if the Supabase URL points to a production project
   */
  isProductionSupabase(): boolean {
    const ref = extractSupabaseRef(getSupabaseUrl())
    return PRODUCTION_SUPABASE_REFS.includes(ref)
  },

  /**
   * Returns true if the app URL is a production domain
   */
  isProductionDomain(): boolean {
    const appUrl = getAppUrl()
    return PRODUCTION_DOMAINS.some(d => appUrl.includes(d) && !appUrl.includes('dev.'))
  },

  /**
   * Throws if the environment looks like production.
   * Call this at the top of dev-only operations.
   */
  assertDev(): void {
    if (envGuard.isProductionSupabase()) {
      throw new Error(
        '[ENV_GUARD] BLOCKED: Supabase URL points to production project. ' +
        'This operation is not allowed in production. ' +
        `Current ref: ${extractSupabaseRef(getSupabaseUrl())}`
      )
    }
    if (envGuard.isProductionDomain()) {
      throw new Error(
        '[ENV_GUARD] BLOCKED: App URL points to production domain. ' +
        `Current: ${getAppUrl()}`
      )
    }
  },

  /**
   * Returns true if cron jobs should execute in this environment.
   * Cron runs in all environments but this guard prevents
   * accidental production-affecting behavior in dev.
   */
  cronAllowed(): boolean {
    // Cron is always allowed — the guard is about WHAT the cron does,
    // not whether it runs. The cron auth (CRON_SECRET) handles access control.
    return true
  },

  /**
   * Returns true if outbound messaging (WhatsApp, Email, SMS)
   * should actually send in this environment.
   *
   * In development, we default to NOT sending unless explicitly enabled.
   */
  messagingEnabled(): boolean {
    if (envGuard.isDev()) {
      // Only send if explicitly enabled for dev
      return process.env.DEV_MESSAGING_ENABLED === 'true'
    }
    return true
  },

  /**
   * Returns true if payment processing should use live/production mode.
   * In development, always returns false (sandbox mode).
   */
  paymentsLive(): boolean {
    if (envGuard.isDev()) {
      return false
    }
    return true
  },

  /**
   * Get the correct app base URL for the current environment
   */
  getAppBaseUrl(): string {
    return getAppUrl() || 'https://dev.serapod2u.com'
  },

  /**
   * Log environment info at startup (non-sensitive)
   */
  logEnvironment(): void {
    const ref = extractSupabaseRef(getSupabaseUrl())
    console.log(`[ENV_GUARD] Environment: ${getAppEnv()}`)
    console.log(`[ENV_GUARD] App URL: ${getAppUrl()}`)
    console.log(`[ENV_GUARD] Supabase ref: ${ref}`)
    console.log(`[ENV_GUARD] Is production Supabase: ${envGuard.isProductionSupabase()}`)
    console.log(`[ENV_GUARD] Messaging enabled: ${envGuard.messagingEnabled()}`)
    console.log(`[ENV_GUARD] Payments live: ${envGuard.paymentsLive()}`)
  },

  /**
   * Validate that a URL does not point to a production resource.
   * Use this to guard webhook callbacks, cron targets, etc.
   */
  assertNotProductionUrl(url: string, context: string): void {
    for (const domain of PRODUCTION_DOMAINS) {
      if (url.includes(domain) && !url.includes('dev.')) {
        throw new Error(
          `[ENV_GUARD] BLOCKED (${context}): URL points to production domain. ` +
          `URL: ${url}`
        )
      }
    }
  },
}
