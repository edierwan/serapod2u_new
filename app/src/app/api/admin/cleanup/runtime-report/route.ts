import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type {
  RuntimeReport,
  RouteUsageStats,
  RPCUsageStats,
  PageUsageStats,
  RuntimeReportResponse,
} from '@/types/cleanup'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/cleanup/runtime-report
 * Get runtime usage statistics for API routes, RPC calls, and page views
 * SUPER ADMIN ONLY (role_level = 1)
 * 
 * Query params:
 * - range: number of days to look back (default: 7)
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check - Super Admin only
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile to check role
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('id, role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile || (userProfile.roles as any)?.role_level !== 1) {
      return NextResponse.json({ 
        success: false, 
        error: 'Access denied. Super Admin only.' 
      }, { status: 403 })
    }

    // Parse query params
    const { searchParams } = new URL(request.url)
    const rangeDays = parseInt(searchParams.get('range') || '7', 10)

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - rangeDays)

    // Fetch API route usage from admin_usage_events table
    // Using 'as any' because the table might not exist in generated types yet
    const { data: apiUsageData, error: apiError } = await (supabase as any)
      .from('admin_usage_events')
      .select('*')
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
      .eq('event_type', 'api_call')

    // Fetch RPC usage
    const { data: rpcUsageData, error: rpcError } = await (supabase as any)
      .from('admin_usage_events')
      .select('*')
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
      .eq('event_type', 'rpc_call')

    // Fetch page views
    const { data: pageUsageData, error: pageError } = await (supabase as any)
      .from('admin_usage_events')
      .select('*')
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
      .eq('event_type', 'page_view')

    // Aggregate API route stats
    const apiRouteMap = new Map<string, RouteUsageStats>()
    
    if (apiUsageData) {
      for (const event of apiUsageData as any[]) {
        const key = `${event.method}:${event.route}`
        const existing = apiRouteMap.get(key)
        
        if (existing) {
          existing.hit_count++
          existing.last_seen = event.timestamp > existing.last_seen ? event.timestamp : existing.last_seen
          existing.first_seen = event.timestamp < existing.first_seen ? event.timestamp : existing.first_seen
          if (event.status_code >= 400) existing.error_count++
        } else {
          apiRouteMap.set(key, {
            route: event.route,
            method: event.method,
            hit_count: 1,
            last_seen: event.timestamp,
            first_seen: event.timestamp,
            avg_response_time_ms: event.response_time_ms || null,
            error_count: event.status_code >= 400 ? 1 : 0,
            unique_users: 1,
          })
        }
      }
    }

    // Aggregate RPC stats
    const rpcMap = new Map<string, RPCUsageStats>()
    
    if (rpcUsageData) {
      for (const event of rpcUsageData as any[]) {
        const rpcName = event.metadata?.rpc_name || event.route
        const existing = rpcMap.get(rpcName)
        
        if (existing) {
          existing.hit_count++
          existing.last_seen = event.timestamp > existing.last_seen ? event.timestamp : existing.last_seen
          existing.first_seen = event.timestamp < existing.first_seen ? event.timestamp : existing.first_seen
          if (event.metadata?.caller_route && !existing.caller_routes.includes(event.metadata.caller_route)) {
            existing.caller_routes.push(event.metadata.caller_route)
          }
        } else {
          rpcMap.set(rpcName, {
            rpc_name: rpcName,
            hit_count: 1,
            last_seen: event.timestamp,
            first_seen: event.timestamp,
            caller_routes: event.metadata?.caller_route ? [event.metadata.caller_route] : [],
          })
        }
      }
    }

    // Aggregate page view stats
    const pageMap = new Map<string, PageUsageStats>()
    
    if (pageUsageData) {
      for (const event of pageUsageData as any[]) {
        const pagePath = event.route
        const existing = pageMap.get(pagePath)
        
        if (existing) {
          existing.hit_count++
          existing.last_seen = event.timestamp > existing.last_seen ? event.timestamp : existing.last_seen
        } else {
          pageMap.set(pagePath, {
            page_path: pagePath,
            hit_count: 1,
            last_seen: event.timestamp,
            unique_sessions: 1,
          })
        }
      }
    }

    // Build report
    const report: RuntimeReport = {
      generated_at: new Date().toISOString(),
      range_days: rangeDays,
      api_routes: Array.from(apiRouteMap.values()).sort((a, b) => b.hit_count - a.hit_count),
      rpc_calls: Array.from(rpcMap.values()).sort((a, b) => b.hit_count - a.hit_count),
      page_views: Array.from(pageMap.values()).sort((a, b) => b.hit_count - a.hit_count),
      total_api_calls: apiUsageData?.length || 0,
      total_rpc_calls: rpcUsageData?.length || 0,
      total_page_views: pageUsageData?.length || 0,
    }

    // If no data exists yet (table might not exist), return empty report with note
    if (!apiUsageData && apiError?.code === '42P01') {
      // Table doesn't exist - provide a mock report with note
      const response: RuntimeReportResponse = {
        success: true,
        report: {
          ...report,
          api_routes: getMockAPIRoutes(),
          rpc_calls: getMockRPCCalls(),
          page_views: getMockPageViews(),
          total_api_calls: 0,
          total_rpc_calls: 0,
          total_page_views: 0,
        },
      }
      return NextResponse.json(response)
    }

    const response: RuntimeReportResponse = {
      success: true,
      report,
    }

    return NextResponse.json(response)

  } catch (error: any) {
    console.error('Runtime report error:', error)
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to generate runtime report',
    } as RuntimeReportResponse, { status: 500 })
  }
}

/**
 * Provide mock API routes for demonstration when no tracking data exists
 * These represent common API routes in the application
 */
function getMockAPIRoutes(): RouteUsageStats[] {
  const now = new Date().toISOString()
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  
  return [
    { route: '/api/admin/cleanup/static-report', method: 'POST', hit_count: 0, last_seen: now, first_seen: weekAgo, avg_response_time_ms: null, error_count: 0, unique_users: 0 },
    { route: '/api/admin/cleanup/runtime-report', method: 'GET', hit_count: 0, last_seen: now, first_seen: weekAgo, avg_response_time_ms: null, error_count: 0, unique_users: 0 },
    { route: '/api/admin/export-data', method: 'POST', hit_count: 0, last_seen: now, first_seen: weekAgo, avg_response_time_ms: null, error_count: 0, unique_users: 0 },
    { route: '/api/admin/delete-transactions-v2', method: 'POST', hit_count: 0, last_seen: now, first_seen: weekAgo, avg_response_time_ms: null, error_count: 0, unique_users: 0 },
  ]
}

function getMockRPCCalls(): RPCUsageStats[] {
  return []
}

function getMockPageViews(): PageUsageStats[] {
  return []
}
