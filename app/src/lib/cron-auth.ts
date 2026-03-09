/**
 * Cron Authentication & Safety Utility
 *
 * Centralizes cron endpoint auth and environment-aware safety checks.
 * Used by all /api/cron/* routes.
 *
 * Usage:
 *   import { verifyCronAuth } from '@/lib/cron-auth'
 *
 *   export async function GET(request: NextRequest) {
 *     const authResult = verifyCronAuth(request)
 *     if (!authResult.ok) return authResult.response
 *     // ... cron logic
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'

interface CronAuthResult {
  ok: boolean
  response: NextResponse
  environment: string
}

/**
 * Verify cron endpoint authorization.
 *
 * Rules:
 * - Always requires CRON_SECRET when set (regardless of environment)
 * - Rejects requests with wrong/missing secret
 * - Logs environment context for debugging
 */
export function verifyCronAuth(request: NextRequest): CronAuthResult {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV || 'unknown'

  // Always require CRON_SECRET if it's configured
  if (cronSecret) {
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      console.warn(`[CRON_AUTH] Unauthorized access attempt | env=${appEnv}`)
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Unauthorized', environment: appEnv },
          { status: 401 }
        ),
        environment: appEnv,
      }
    }
  }

  console.log(`[CRON_AUTH] Authorized | env=${appEnv}`)

  return {
    ok: true,
    response: NextResponse.json({ ok: true }),
    environment: appEnv,
  }
}

/**
 * Check if the current environment should send outbound messages.
 * In development, messaging is disabled by default unless DEV_MESSAGING_ENABLED=true.
 */
export function shouldSendMessages(): boolean {
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV || 'development'
  if (appEnv === 'development') {
    return process.env.DEV_MESSAGING_ENABLED === 'true'
  }
  return true
}

/**
 * Get the cron target base URL for the current environment.
 * Prevents cron from accidentally targeting production URLs.
 */
export function getCronTargetUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV || 'development'

  // Safety: In development, never return a production URL
  if (appEnv === 'development') {
    if (appUrl.includes('serapod2u.com') && !appUrl.includes('dev.')) {
      console.error('[CRON_AUTH] BLOCKED: Dev env has production URL configured!')
      return 'https://dev.serapod2u.com'
    }
  }

  return appUrl || 'https://dev.serapod2u.com'
}
