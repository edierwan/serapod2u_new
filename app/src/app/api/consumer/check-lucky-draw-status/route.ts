import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveQrCodeRecord } from '@/lib/utils/qr-resolver'

/**
 * GET /api/consumer/check-lucky-draw-status
 * Check if a QR code has already been used for lucky draw or points collection
 * 
 * Query params:
 *   qr_code: string - The QR code to check
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

    console.log('🔍 Checking QR status for:', qrCode)

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

    // Use the proper QR code resolver (handles hash suffix, base code, pattern matching)
    const qrCodeData = await resolveQrCodeRecord(supabase, qrCode)

    if (!qrCodeData) {
      console.log('❌ QR code not found:', qrCode)
      return NextResponse.json({
        success: true,
        is_lucky_draw_entered: false,
        is_points_collected: false,
        message: 'QR code not found'
      })
    }

    console.log('✅ Found QR code:', qrCodeData.code, 'ID:', qrCodeData.id)

    // Fetch the full QR code data with lucky draw and points status
    const { data: qrData, error: qrError } = await supabase
      .from('qr_codes')
      .select('id, code, is_lucky_draw_entered, is_points_collected')
      .eq('id', qrCodeData.id)
      .single()

    if (qrError || !qrData) {
      console.error('Error fetching QR details:', qrError)
      return NextResponse.json({
        success: true,
        is_lucky_draw_entered: false,
        is_points_collected: false,
        message: 'Error fetching QR details'
      })
    }

    console.log('📊 QR Status:', {
      is_lucky_draw_entered: qrData.is_lucky_draw_entered,
      is_points_collected: qrData.is_points_collected
    })

    // If lucky draw was entered, get the entry details
    let entryDetails = null
    if (qrData.is_lucky_draw_entered) {
      const { data: entry } = await supabase
        .from('lucky_draw_entries')
        .select('consumer_name, consumer_phone, consumer_email, entry_number, entry_date')
        .eq('qr_code_id', qrData.id)
        .maybeSingle()
      
      if (entry) {
        entryDetails = entry
      }
    }

    return NextResponse.json({
      success: true,
      is_lucky_draw_entered: qrData.is_lucky_draw_entered || false,
      is_points_collected: qrData.is_points_collected || false,
      entry_details: entryDetails
    })

  } catch (error) {
    console.error('Error in check-lucky-draw-status:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
