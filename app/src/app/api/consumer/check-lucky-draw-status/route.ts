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

    // BULLETPROOF: Check lucky_draw_entries table as fallback
    // This catches cases where the flag wasn't set but entry exists
    let isLuckyDrawEntered = qrData.is_lucky_draw_entered || false
    let entryDetails = null

    // Always check the entries table to be sure
    const { data: entry } = await supabase
      .from('lucky_draw_entries')
      .select('id, consumer_name, consumer_phone, consumer_email, entry_number, entry_date')
      .eq('qr_code_id', qrData.id)
      .maybeSingle()
    
    if (entry) {
      console.log('✅ Found lucky draw entry in entries table:', entry.entry_number)
      isLuckyDrawEntered = true
      entryDetails = entry
      
      // SYNC FIX: If flag is false but entry exists, fix the flag
      if (!qrData.is_lucky_draw_entered) {
        console.log('⚠️ Flag mismatch detected! Fixing is_lucky_draw_entered flag...')
        const { error: fixError } = await supabase
          .from('qr_codes')
          .update({ 
            is_lucky_draw_entered: true,
            lucky_draw_entered_at: entry.entry_date || new Date().toISOString()
          })
          .eq('id', qrData.id)
        
        if (fixError) {
          console.error('Failed to fix flag:', fixError)
        } else {
          console.log('✅ Flag fixed successfully')
        }
      }
    }

    // Check if gift already redeemed from this QR
    let isGiftRedeemed = false
    const { data: giftClaim } = await supabase
      .from('gift_claims')
      .select('id')
      .eq('qr_code_id', qrData.id)
      .maybeSingle()
    
    if (giftClaim) {
      isGiftRedeemed = true
    }

    return NextResponse.json({
      success: true,
      is_lucky_draw_entered: isLuckyDrawEntered,
      is_points_collected: qrData.is_points_collected || false,
      is_gift_redeemed: isGiftRedeemed,
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
