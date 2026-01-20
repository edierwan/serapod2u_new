/**
 * Runtime Usage Tracker
 * Lightweight tracking for API routes, RPC calls, and page views
 * Used by the Code Cleanup feature to identify actually-used code paths
 */

import { createClient } from '@/lib/supabase/server'
import type { RuntimeUsageEvent } from '@/types/cleanup'

// In-memory buffer for batching writes (reduces DB calls)
let eventBuffer: RuntimeUsageEvent[] = []
let flushTimeout: NodeJS.Timeout | null = null
const BUFFER_SIZE = 50
const FLUSH_INTERVAL = 30000 // 30 seconds

/**
 * Track an API route call
 */
export async function trackAPICall(
  route: string,
  method: string,
  statusCode: number,
  userRole?: string,
  orgId?: string,
  responseTimeMs?: number
): Promise<void> {
  // Skip tracking for cleanup endpoints themselves to avoid recursion
  if (route.includes('/admin/cleanup/')) return

  const event: RuntimeUsageEvent = {
    route,
    method,
    user_role: userRole || 'anonymous',
    org_id: orgId || null,
    status_code: statusCode,
    timestamp: new Date().toISOString(),
    response_time_ms: responseTimeMs,
  }

  addToBuffer({ ...event, event_type: 'api_call' } as any)
}

/**
 * Track an RPC call
 */
export async function trackRPCCall(
  rpcName: string,
  callerRoute?: string,
  userRole?: string
): Promise<void> {
  const event = {
    route: rpcName,
    method: 'RPC',
    user_role: userRole || 'anonymous',
    org_id: null,
    status_code: 200,
    timestamp: new Date().toISOString(),
    event_type: 'rpc_call',
    metadata: { rpc_name: rpcName, caller_route: callerRoute },
  }

  addToBuffer(event as any)
}

/**
 * Track a page view (SSR)
 */
export async function trackPageView(
  pagePath: string,
  userRole?: string,
  orgId?: string
): Promise<void> {
  const event = {
    route: pagePath,
    method: 'GET',
    user_role: userRole || 'anonymous',
    org_id: orgId || null,
    status_code: 200,
    timestamp: new Date().toISOString(),
    event_type: 'page_view',
  }

  addToBuffer(event as any)
}

/**
 * Add event to buffer and schedule flush
 */
function addToBuffer(event: any): void {
  eventBuffer.push(event)

  // Flush if buffer is full
  if (eventBuffer.length >= BUFFER_SIZE) {
    flushBuffer()
    return
  }

  // Schedule flush if not already scheduled
  if (!flushTimeout) {
    flushTimeout = setTimeout(flushBuffer, FLUSH_INTERVAL)
  }
}

/**
 * Flush buffered events to database
 */
async function flushBuffer(): Promise<void> {
  if (flushTimeout) {
    clearTimeout(flushTimeout)
    flushTimeout = null
  }

  if (eventBuffer.length === 0) return

  const eventsToFlush = [...eventBuffer]
  eventBuffer = []

  try {
    const supabase = await createClient()
    
    // Insert events in batch
    // Using 'as any' because the table might not exist in generated types yet
    const { error } = await (supabase as any)
      .from('admin_usage_events')
      .insert(eventsToFlush.map((e: any) => ({
        event_type: e.event_type,
        route: e.route,
        method: e.method,
        user_role: e.user_role,
        org_id: e.org_id,
        status_code: e.status_code,
        response_time_ms: e.response_time_ms,
        metadata: e.metadata || {},
        timestamp: e.timestamp,
      })))

    if (error) {
      // Log error but don't throw - tracking should not break the app
      console.warn('[UsageTracker] Failed to flush events:', error.message)
      
      // If table doesn't exist, silently ignore
      if (error.code !== '42P01') {
        // Re-add events to buffer for retry (up to a limit)
        if (eventBuffer.length < BUFFER_SIZE * 2) {
          eventBuffer = [...eventsToFlush, ...eventBuffer]
        }
      }
    }
  } catch (error: any) {
    // Silently fail - tracking should not impact main functionality
    console.warn('[UsageTracker] Error flushing events:', error.message)
  }
}

/**
 * Force flush (useful for cleanup/shutdown)
 */
export async function forceFlush(): Promise<void> {
  await flushBuffer()
}

/**
 * API route wrapper that adds tracking
 * Use this to wrap your route handlers
 */
export function withUsageTracking<T extends (...args: any[]) => Promise<Response>>(
  handler: T,
  route: string
): T {
  return (async (...args: any[]) => {
    const startTime = Date.now()
    let response: Response
    
    try {
      response = await handler(...args)
    } catch (error) {
      const responseTime = Date.now() - startTime
      trackAPICall(route, 'ERROR', 500, undefined, undefined, responseTime)
      throw error
    }

    const responseTime = Date.now() - startTime
    
    // Extract method from request if available
    const request = args[0] as Request | undefined
    const method = request?.method || 'GET'

    // Track the call (async, non-blocking)
    trackAPICall(route, method, response.status, undefined, undefined, responseTime)

    return response
  }) as T
}

/**
 * RPC wrapper that adds tracking
 * Use this to wrap your RPC calls
 */
export async function trackedRPC<T>(
  supabase: any,
  rpcName: string,
  params?: object,
  callerRoute?: string
): Promise<{ data: T | null; error: any }> {
  const result = await supabase.rpc(rpcName, params)
  
  // Track the RPC call (async, non-blocking)
  trackRPCCall(rpcName, callerRoute)
  
  return result
}
