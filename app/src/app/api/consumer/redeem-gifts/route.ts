import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getBaseCode } from '@/lib/security/qr-hash'

/**
 * GET /api/consumer/redeem-gifts?qr_code=xxx
 * Fetch available redeem gifts for a scanned QR code
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const qrCode = searchParams.get('qr_code')

    if (!qrCode) {
      return NextResponse.json(
        { success: false, error: 'QR code is required' },
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

    const baseCode = getBaseCode(qrCode)

    // Find QR code
    const { data: qrCodeData } = await supabase
      .from('qr_codes')
      .select('id, order_id')
      .or(`code.eq.${qrCode},code.eq.${baseCode}`)
      .maybeSingle()

    if (!qrCodeData) {
      return NextResponse.json(
        { success: false, error: 'QR code not found' },
        { status: 404 }
      )
    }

    // Fetch active redeem gifts for this order
    const { data: gifts, error } = await supabase
      .from('redeem_gifts')
      .select('*')
      .eq('order_id', qrCodeData.order_id)
      .eq('is_active', true)

    if (error) {
      console.error('Error fetching redeem gifts:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch gifts' },
        { status: 500 }
      )
    }

    // Filter gifts by date and availability
    const now = new Date()
    const availableGifts = gifts?.filter(gift => {
      if (gift.start_date && new Date(gift.start_date) > now) return false
      if (gift.end_date && new Date(gift.end_date) < now) return false
      if (gift.claimed_quantity >= gift.total_quantity) return false
      return true
    }) || []

    return NextResponse.json({
      success: true,
      gifts: availableGifts
    })

  } catch (error) {
    console.error('Error in redeem-gifts API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
