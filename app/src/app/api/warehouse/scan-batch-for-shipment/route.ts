import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadSession, processShipmentScan } from '../scan-for-shipment/route'

// Performance optimization: Process codes in concurrent batches
const CONCURRENT_BATCH_SIZE = 10 // Process 10 codes at a time
const PROGRESS_UPDATE_INTERVAL = 5 // Send progress update every 5 codes

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
          // Process codes in concurrent batches for better performance
          for (let batchStart = 0; batchStart < codes.length; batchStart += CONCURRENT_BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + CONCURRENT_BATCH_SIZE, codes.length)
            const batchCodes = codes.slice(batchStart, batchEnd)

            // Process current batch concurrently
            const batchPromises = batchCodes.map(async (code, batchIndex) => {
              const globalIndex = batchStart + batchIndex
              
              try {
                const { result, status } = await processShipmentScan({
                  supabase,
                  session,
                  code,
                  requestingUserId
                })

                return {
                  index: globalIndex,
                  code,
                  result,
                  status
                }
              } catch (error: any) {
                console.error(`❌ Error processing code at index ${globalIndex}:`, error)
                return {
                  index: globalIndex,
                  code,
                  result: {
                    code,
                    normalized_code: code,
                    code_type: 'master' as const,
                    outcome: 'error' as const,
                    message: error?.message || 'Processing failed'
                  },
                  status: 500
                }
              }
            })

            // Wait for current batch to complete
            const batchResults = await Promise.all(batchPromises)

            // Process results and send progress updates
            for (const { index, code, result, status } of batchResults) {
              if (result.outcome === 'shipped') {
                successCount++
              } else if (result.outcome === 'duplicate') {
                duplicateCount++
              } else {
                errorCount++
              }

              // Send progress update (every N codes or last code in batch)
              const shouldSendUpdate = 
                (index + 1) % PROGRESS_UPDATE_INTERVAL === 0 || 
                index === batchResults[batchResults.length - 1].index

              if (shouldSendUpdate) {
                const payload = {
                  type: 'progress' as const,
                  index: index + 1,
                  total,
                  status,
                  result
                }

                controller.enqueue(encoder.encode(JSON.stringify(payload) + '\n'))
              }
            }
          }

          // Send final summary
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
