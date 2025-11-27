import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getBaseCode } from '@/lib/security/qr-hash'

/**
 * POST /api/consumer/lucky-draw-entry
 * Submit a lucky draw entry from a consumer scanning a QR code
 * 
 * Body:
 *   qr_code: string - The QR code that was scanned (with or without hash suffix)
 *   consumer_name: string - Consumer's name
 *   consumer_phone: string - Consumer's phone number
 *   consumer_email?: string - Consumer's email (optional)
 */
export async function POST(request: NextRequest) {
  try {
    // Use service role for consumer operations (no auth required)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )
    
    const { qr_code, consumer_name, consumer_phone, consumer_email } = await request.json()

    // Validate required fields
    if (!qr_code || !consumer_name || !consumer_phone) {
      return NextResponse.json(
        { success: false, error: 'QR code, name, and phone are required' },
        { status: 400 }
      )
    }

    // Call the secure RPC function
    const { data: result, error: rpcError } = await supabase.rpc('consumer_lucky_draw_enter', {
      p_raw_qr_code: qr_code,
      p_consumer_name: consumer_name,
      p_consumer_phone: consumer_phone,
      p_consumer_email: consumer_email || null
    })

    if (rpcError) {
      console.error('RPC Error:', rpcError)
      return NextResponse.json(
        { success: false, error: 'Database error: ' + rpcError.message },
        { status: 500 }
      )
    }

    // Handle RPC result
    if (!result.success) {
      // Map specific error codes to HTTP status
      if (result.preview) {
        return NextResponse.json(result, { status: 404 })
      }
      if (result.code === 'QR_NOT_FOUND' || result.code === 'NO_CAMPAIGN') {
        return NextResponse.json(result, { status: 404 })
      }
      if (result.code === 'INVALID_STATUS') {
        return NextResponse.json(result, { status: 400 })
      }
      // Default error
      return NextResponse.json(result, { status: 400 })
    }

    // Success (or already entered success case)
    return NextResponse.json(result)

  } catch (error) {
    console.error('Error in consumer/lucky-draw-entry:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
