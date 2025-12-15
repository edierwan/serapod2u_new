import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const STALE_THRESHOLD_MS = 3 * 60 * 1000 // 3 minutes

/**
 * Diagnostic endpoint for warehouse receiving status
 * 
 * Returns:
 * - Current job status
 * - Heartbeat age
 * - Progress counts
 * - Stale detection
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const batchId = searchParams.get('batch_id')
  const orderId = searchParams.get('order_id')

  const supabase = createAdminClient()

  try {
    let query = supabase
      .from('qr_batches')
      .select(`
        id,
        order_id,
        total_codes,
        total_unique_codes,
        total_master_codes,
        receiving_status,
        receiving_worker_id,
        receiving_heartbeat,
        receiving_progress,
        receiving_started_at,
        receiving_completed_at,
        last_error,
        created_at,
        orders!inner (
          order_no
        )
      `)
      .in('receiving_status', ['queued', 'processing', 'completed', 'failed', 'cancelled'])

    if (batchId) {
      query = query.eq('id', batchId)
    } else if (orderId) {
      query = query.eq('order_id', orderId)
    }

    const { data: batches, error } = await query.order('created_at', { ascending: false }).limit(10)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!batches || batches.length === 0) {
      return NextResponse.json({ 
        message: 'No batches found with receiving status',
        batches: []
      })
    }

    // Enrich with real-time counts and stale detection
    const now = new Date()
    const enrichedBatches = await Promise.all(batches.map(async (batch) => {
      // Get actual code counts
      const [masterResult, uniqueResult, uniqueDoneResult] = await Promise.all([
        supabase
          .from('qr_master_codes')
          .select('status', { count: 'exact', head: true })
          .eq('batch_id', batch.id)
          .eq('status', 'received_warehouse'),
        supabase
          .from('qr_codes')
          .select('status', { count: 'exact', head: true })
          .eq('batch_id', batch.id)
          .eq('is_buffer', false)
          .eq('status', 'ready_to_ship'),
        supabase
          .from('qr_codes')
          .select('status', { count: 'exact', head: true })
          .eq('batch_id', batch.id)
          .eq('is_buffer', false)
          .eq('status', 'received_warehouse')
      ])

      const masterDone = masterResult.count || 0
      const uniquePending = uniqueResult.count || 0
      const uniqueDone = uniqueDoneResult.count || 0

      // Calculate stale status
      let isStale = false
      let heartbeatAgeMs = null
      let heartbeatAge = null

      if (batch.receiving_status === 'processing' && batch.receiving_heartbeat) {
        const heartbeatTime = new Date(batch.receiving_heartbeat)
        heartbeatAgeMs = now.getTime() - heartbeatTime.getTime()
        heartbeatAge = `${Math.round(heartbeatAgeMs / 1000)}s ago`
        isStale = heartbeatAgeMs > STALE_THRESHOLD_MS
      } else if (batch.receiving_status === 'processing' && !batch.receiving_heartbeat) {
        isStale = true
        heartbeatAge = 'never'
      }

      // Calculate elapsed time
      let elapsedTime = null
      if (batch.receiving_started_at) {
        const startTime = new Date(batch.receiving_started_at)
        const endTime = batch.receiving_completed_at 
          ? new Date(batch.receiving_completed_at) 
          : now
        const elapsedMs = endTime.getTime() - startTime.getTime()
        const minutes = Math.floor(elapsedMs / 60000)
        const seconds = Math.floor((elapsedMs % 60000) / 1000)
        elapsedTime = `${minutes}m ${seconds}s`
      }

      // Calculate progress percentage
      const totalUnique = batch.total_unique_codes || 0
      const progressPercent = totalUnique > 0 
        ? Math.round((uniqueDone / totalUnique) * 100) 
        : 0

      return {
        batch_id: batch.id,
        order_no: (batch.orders as any)?.order_no,
        status: batch.receiving_status,
        worker_id: batch.receiving_worker_id,
        
        // Progress
        progress: {
          master_codes: {
            done: masterDone,
            total: batch.total_master_codes
          },
          unique_codes: {
            done: uniqueDone,
            pending: uniquePending,
            total: batch.total_unique_codes,
            percent: progressPercent
          },
          reported_progress: batch.receiving_progress
        },

        // Timing
        timing: {
          started_at: batch.receiving_started_at,
          completed_at: batch.receiving_completed_at,
          elapsed: elapsedTime
        },

        // Health
        health: {
          is_stale: isStale,
          heartbeat: batch.receiving_heartbeat,
          heartbeat_age: heartbeatAge,
          heartbeat_age_ms: heartbeatAgeMs,
          stale_threshold_ms: STALE_THRESHOLD_MS
        },

        // Error
        last_error: batch.last_error,

        // Recommendations
        recommendations: getRecommendations(batch.receiving_status, isStale, uniquePending, batch.last_error)
      }
    }))

    return NextResponse.json({
      timestamp: now.toISOString(),
      batches: enrichedBatches
    })

  } catch (error: any) {
    console.error('Error in receiving-status:', error)
    return NextResponse.json({ 
      error: error.message || 'Unknown error'
    }, { status: 500 })
  }
}

function getRecommendations(status: string, isStale: boolean, pendingCount: number, lastError: string | null): string[] {
  const recommendations: string[] = []

  if (status === 'processing' && isStale) {
    recommendations.push('Job appears stale - consider resetting and retrying')
    recommendations.push('Use POST /api/warehouse/reset-receiving to reset')
  }

  if (status === 'failed') {
    recommendations.push('Job failed - reset and retry')
    if (lastError) {
      recommendations.push(`Error was: ${lastError}`)
    }
  }

  if (status === 'queued') {
    recommendations.push('Job is queued - worker should pick it up automatically')
    recommendations.push('Ensure worker endpoint is being polled')
  }

  if (status === 'completed' && pendingCount > 0) {
    recommendations.push(`Warning: ${pendingCount} codes still pending despite completion`)
    recommendations.push('May need to reset and reprocess')
  }

  if (status === 'processing' && !isStale) {
    recommendations.push('Job is actively processing - wait for completion')
  }

  return recommendations
}
