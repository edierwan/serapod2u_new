/**
 * GET /api/ai/metrics
 *
 * Admin-only endpoint returning the last 100 AI request metrics.
 * Response: { metrics: AiRequestMetric[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMetrics } from '@/lib/ai/metrics'
import { getWarmStatus } from '@/lib/ai/warmup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  try {
    // Auth: require logged-in user with admin-level role
    const supabase = (await createClient()) as any
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role — look for SUPER_ADMIN or HR_MANAGER in any org
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role_code, role_level')
      .eq('user_id', user.id)
      .limit(1)
      .single()

    const isAdmin =
      membership?.role_code === 'SUPER_ADMIN' ||
      membership?.role_code === 'OWNER' ||
      (membership?.role_level != null && membership.role_level >= 80)

    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const metrics = getMetrics()
    const warmStatus = getWarmStatus()

    // Compute summary stats
    const successful = metrics.filter((m) => !m.error)
    const avgTtft =
      successful.length > 0
        ? Math.round(
            successful.reduce((sum, m) => sum + (m.time_to_first_token_ms > 0 ? m.time_to_first_token_ms : 0), 0) /
              Math.max(successful.filter((m) => m.time_to_first_token_ms > 0).length, 1),
          )
        : 0
    const avgTotal =
      successful.length > 0
        ? Math.round(successful.reduce((sum, m) => sum + m.total_ms, 0) / successful.length)
        : 0
    const errorRate =
      metrics.length > 0
        ? Math.round((metrics.filter((m) => m.error).length / metrics.length) * 100)
        : 0

    return NextResponse.json({
      metrics,
      summary: {
        total_requests: metrics.length,
        errors: metrics.filter((m) => m.error).length,
        error_rate_pct: errorRate,
        avg_time_to_first_token_ms: avgTtft,
        avg_total_ms: avgTotal,
        fast_path_count: metrics.filter((m) => m.mode === 'fast-path').length,
        stream_count: metrics.filter((m) => m.mode === 'stream').length,
      },
      warm: warmStatus,
    })
  } catch (err: any) {
    console.error('[AI Metrics] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
