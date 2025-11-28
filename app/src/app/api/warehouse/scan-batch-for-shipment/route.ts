import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadSession } from '../scan-for-shipment/route'
import { processBatchShipment } from './batch-processor'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      shipment_session_id: sessionId,
      codes,
      user_id: overrideUserId
    } = body || {}

    if (!sessionId) {
      return NextResponse.json({ message: 'shipment_session_id is required' }, { status: 400 })
    }

    if (!Array.isArray(codes) || codes.length === 0) {
      return NextResponse.json({ message: 'codes array must contain at least one value' }, { status: 400 })
    }

    const session = await loadSession(supabase, sessionId)

    if (session.validation_status === 'approved') {
      return NextResponse.json({ message: 'Shipment session already completed' }, { status: 409 })
    }

    const requestingUserId = overrideUserId || user.id
    const encoder = new TextEncoder()

    // Perform bulk processing
    // This is significantly faster than sequential processing
    const { results, summary, sessionUpdate } = await processBatchShipment(
      supabase,
      session,
      codes,
      requestingUserId
    )

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Stream individual results to satisfy client expectation
          // Since we already processed everything, we can just dump them
          // We'll chunk them slightly to avoid blocking the event loop if the list is huge
          const CHUNK_SIZE = 20
          
          for (let i = 0; i < results.length; i += CHUNK_SIZE) {
            const chunk = results.slice(i, i + CHUNK_SIZE)
            
            for (const result of chunk) {
              // Calculate index for progress
              const index = results.indexOf(result)
              
              // Attach session update to the result if it was successful
              // This ensures the frontend updates the progress bar and quantities
              if (result.outcome === 'shipped' && sessionUpdate) {
                result.session_update = sessionUpdate
              }

              // Send progress update for every item (or we could skip some)
              // The client expects 'progress' events
              const payload = {
                type: 'progress' as const,
                index: index + 1,
                total: summary.total,
                status: result.outcome === 'shipped' || result.outcome === 'duplicate' ? 200 : 400,
                result
              }
              controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'))
            }
            
            // Small yield to allow flush
            await new Promise(resolve => setTimeout(resolve, 0))
          }

          // Send final summary
          const finalPayload = {
            type: 'complete' as const,
            summary
          }

          controller.enqueue(encoder.encode(JSON.stringify(finalPayload) + '\n'))
          controller.close()
        } catch (error: any) {
          console.error('❌ Batch stream error:', error)
          const errorPayload = {
            type: 'error' as const,
            message: error?.message || 'Stream processing failed'
          }
          controller.enqueue(encoder.encode(JSON.stringify(errorPayload) + '\n'))
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store'
      }
    })
  } catch (error: any) {
    console.error('❌ Failed to initiate batch shipment scan:', error)
    return NextResponse.json(
      { message: error?.message || 'Failed to start batch shipment scan' },
      { status: error?.status || 500 }
    )
  }
}
