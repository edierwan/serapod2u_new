import { NextResponse } from 'next/server'
import { envGuard } from '@/lib/env-guard'

export const dynamic = 'force-dynamic'

/**
 * GET /api/health
 *
 * Healthcheck endpoint for Coolify deployment monitoring.
 * Returns environment info and basic connectivity status.
 */
export async function GET() {
  const appEnv = process.env.NEXT_PUBLIC_APP_ENV || 'unknown'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'unknown'

  // Basic database connectivity check via Supabase
  let dbStatus = 'unknown'
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const supabase = createAdminClient()
    const { error } = await supabase.from('organizations').select('id').limit(1)
    dbStatus = error ? `error: ${error.message}` : 'connected'
  } catch (e: any) {
    dbStatus = `error: ${e.message}`
  }

  return NextResponse.json({
    status: 'ok',
    environment: appEnv,
    app_url: appUrl,
    database: dbStatus,
    is_production_supabase: envGuard.isProductionSupabase(),
    messaging_enabled: envGuard.messagingEnabled(),
    timestamp: new Date().toISOString(),
  })
}
