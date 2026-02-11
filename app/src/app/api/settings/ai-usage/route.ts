/**
 * GET /api/settings/ai-usage
 *
 * Returns AI usage analytics for the current org.
 * Query params:
 *   - period: '7d' | '30d' | '90d' (default: '30d')
 *   - groupBy: 'user' | 'module' | 'provider' | 'day' (default: 'day')
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHrAuthContext, canManageHr } from '@/lib/server/hrAccess'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const authResult = await getHrAuthContext(supabase)
    if (!authResult.success || !authResult.data) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const ctx = authResult.data
    if (!ctx.organizationId) {
      return NextResponse.json({ error: 'No organization' }, { status: 400 })
    }

    const isAdmin = await canManageHr(ctx)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const url = new URL(request.url)
    const period = url.searchParams.get('period') ?? '30d'

    // Calculate date range
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceIso = since.toISOString()

    const admin = createAdminClient()

    // Fetch all usage logs for the period
    const { data: logs, error: logsError } = await (admin as any)
      .from('ai_usage_logs')
      .select('id, user_id, provider, module, model, tokens_used, response_ms, status, error_message, created_at')
      .eq('organization_id', ctx.organizationId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(5000)

    if (logsError) {
      console.error('[AI Usage GET] Error:', logsError.message)
      return NextResponse.json({ error: 'Failed to fetch usage' }, { status: 500 })
    }

    const rows = logs ?? []

    // Get user names for the user IDs in the logs
    const userIds = [...new Set(rows.map((r: any) => r.user_id))]
    let userMap: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: users } = await (admin as any)
        .from('users')
        .select('id, full_name, email')
        .in('id', userIds)

      if (users) {
        for (const u of users) {
          userMap[u.id] = u.full_name || u.email || u.id.slice(0, 8)
        }
      }
    }

    // Aggregate stats
    const totalRequests = rows.length
    const successCount = rows.filter((r: any) => r.status === 'success').length
    const errorCount = rows.filter((r: any) => r.status === 'error').length
    const offlineCount = rows.filter((r: any) => r.status === 'offline').length
    const totalTokens = rows.reduce((sum: number, r: any) => sum + (r.tokens_used || 0), 0)
    const avgResponseMs = totalRequests > 0
      ? Math.round(rows.reduce((sum: number, r: any) => sum + (r.response_ms || 0), 0) / totalRequests)
      : 0

    // Group by day
    const byDay: Record<string, { date: string; requests: number; success: number; errors: number; tokens: number }> = {}
    for (const r of rows as any[]) {
      const date = r.created_at.split('T')[0]
      if (!byDay[date]) byDay[date] = { date, requests: 0, success: 0, errors: 0, tokens: 0 }
      byDay[date].requests++
      if (r.status === 'success') byDay[date].success++
      if (r.status === 'error') byDay[date].errors++
      byDay[date].tokens += r.tokens_used || 0
    }
    const dailyStats = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date))

    // Group by module
    const byModule: Record<string, { module: string; requests: number; success: number; errors: number; avgMs: number }> = {}
    for (const r of rows as any[]) {
      const mod = r.module || 'unknown'
      if (!byModule[mod]) byModule[mod] = { module: mod, requests: 0, success: 0, errors: 0, avgMs: 0 }
      byModule[mod].requests++
      if (r.status === 'success') byModule[mod].success++
      if (r.status === 'error') byModule[mod].errors++
    }
    // Compute avg response time per module
    for (const mod of Object.keys(byModule)) {
      const modRows = rows.filter((r: any) => (r.module || 'unknown') === mod)
      byModule[mod].avgMs = modRows.length > 0
        ? Math.round(modRows.reduce((sum: number, r: any) => sum + (r.response_ms || 0), 0) / modRows.length)
        : 0
    }
    const moduleStats = Object.values(byModule)

    // Group by user
    const byUser: Record<string, { userId: string; userName: string; requests: number; success: number; errors: number; lastUsed: string }> = {}
    for (const r of rows as any[]) {
      const uid = r.user_id
      if (!byUser[uid]) {
        byUser[uid] = {
          userId: uid,
          userName: userMap[uid] || uid.slice(0, 8),
          requests: 0,
          success: 0,
          errors: 0,
          lastUsed: r.created_at,
        }
      }
      byUser[uid].requests++
      if (r.status === 'success') byUser[uid].success++
      if (r.status === 'error') byUser[uid].errors++
      if (r.created_at > byUser[uid].lastUsed) byUser[uid].lastUsed = r.created_at
    }
    const userStats = Object.values(byUser).sort((a, b) => b.requests - a.requests)

    // Group by provider
    const byProvider: Record<string, { provider: string; requests: number; success: number; errors: number }> = {}
    for (const r of rows as any[]) {
      const p = r.provider || 'unknown'
      if (!byProvider[p]) byProvider[p] = { provider: p, requests: 0, success: 0, errors: 0 }
      byProvider[p].requests++
      if (r.status === 'success') byProvider[p].success++
      if (r.status === 'error') byProvider[p].errors++
    }
    const providerStats = Object.values(byProvider)

    // Collect error logs for error-detail modal
    const errorLogs = rows
      .filter((r: any) => r.status === 'error' || r.status === 'offline')
      .map((r: any) => ({
        id: r.id,
        provider: r.provider,
        module: r.module || 'unknown',
        model: r.model,
        errorMessage: r.error_message || 'Unknown error',
        status: r.status,
        responseMs: r.response_ms,
        userId: r.user_id,
        userName: userMap[r.user_id] || r.user_id?.slice(0, 8),
        createdAt: r.created_at,
      }))

    return NextResponse.json({
      period,
      days,
      summary: {
        totalRequests,
        successCount,
        errorCount,
        offlineCount,
        successRate: totalRequests > 0 ? Math.round((successCount / totalRequests) * 100) : 0,
        totalTokens,
        avgResponseMs,
        uniqueUsers: userIds.length,
      },
      dailyStats,
      moduleStats,
      userStats,
      providerStats,
      errorLogs,
    })
  } catch (err: any) {
    console.error('[AI Usage GET]', err.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
