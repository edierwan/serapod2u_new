import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadSession, processShipmentScan } from '../scan-for-shipment/route'

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
    const total = codes.length
    const encoder = new TextEncoder()

    let successCount = 0
    let duplicateCount = 0
    let errorCount = 0

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (let index = 0; index < codes.length; index++) {
            const code = codes[index]

            const { result, status } = await processShipmentScan({
              supabase,
              session,
              code,
              requestingUserId
            })

            if (result.outcome === 'shipped') {
              successCount++
            } else if (result.outcome === 'duplicate') {
              duplicateCount++
            } else {
              errorCount++
            }

            const payload = {
              type: 'progress' as const,
              index: index + 1,
              total,
              status,
              result
            }

            controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'))
          }

          const finalPayload = {
            type: 'complete' as const,
            summary: {
              total,
              success: successCount,
              duplicates: duplicateCount,
              errors: errorCount
            }
          }

          controller.enqueue(encoder.encode(JSON.stringify(finalPayload) + '\n'))
          controller.close()
        } catch (error: any) {
          console.error('❌ Batch shipment scan error:', error)
          const errorPayload = {
            type: 'error' as const,
            message: error?.message || 'Batch processing failed'
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
