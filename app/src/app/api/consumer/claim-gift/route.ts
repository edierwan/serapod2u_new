import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getBaseCode } from '@/lib/security/qr-hash'

/**
 * POST /api/consumer/claim-gift
 * Claim a redeem gift and update quantities
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { qr_code, gift_id, consumer_phone, consumer_name, consumer_email } = body

    if (!qr_code || !gift_id) {
      return NextResponse.json(
        { success: false, error: 'QR code and gift ID are required' },
        { status: 400 }
      )
    }

    // Use service role for consumer operations
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

    // Call the secure RPC function
    const { data: result, error: rpcError } = await supabase.rpc('consumer_claim_gift', {
      p_raw_qr_code: qr_code,
      p_gift_id: gift_id,
      p_consumer_name: consumer_name || null,
      p_consumer_phone: consumer_phone || null,
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
      if (result.code === 'QR_NOT_FOUND' || result.code === 'GIFT_NOT_FOUND') {
        return NextResponse.json(result, { status: 404 })
      }
      if (result.code === 'INVALID_STATUS' || result.code === 'ALREADY_REDEEMED' || result.code === 'GIFT_FULLY_CLAIMED') {
        return NextResponse.json(result, { status: 400 })
      }
      // Default error
      return NextResponse.json(result, { status: 400 })
    }

    // Success
    return NextResponse.json(result)

  } catch (error) {
    console.error('Error in claim-gift API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
