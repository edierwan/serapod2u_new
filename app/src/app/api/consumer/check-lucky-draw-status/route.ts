import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/consumer/check-lucky-draw-status
 * Check if a QR code has already been used for lucky draw
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

    // Try to find QR code with exact match first
    let { data: qrData, error: qrError } = await supabase
      .from('qr_codes')
      .select('id, code, is_lucky_draw_entered, is_points_collected')
      .eq('code', qrCode)
      .maybeSingle()

    // If not found, try base code (remove hash suffix)
    if (!qrData) {
      const baseCode = qrCode.replace(/-[^-]+$/, '')
      if (baseCode !== qrCode) {
        const { data: baseData } = await supabase
          .from('qr_codes')
          .select('id, code, is_lucky_draw_entered, is_points_collected')
          .eq('code', baseCode)
          .maybeSingle()
        
        if (baseData) {
          qrData = baseData
        }
      }
    }

    if (!qrData) {
      return NextResponse.json({
        success: true,
        is_lucky_draw_entered: false,
        is_points_collected: false,
        message: 'QR code not found'
      })
    }

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
