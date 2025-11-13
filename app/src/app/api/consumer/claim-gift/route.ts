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
    const { qr_code, gift_id, consumer_phone } = body

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

    const baseCode = getBaseCode(qr_code)

    // Find QR code
    const { data: qrCodeData } = await supabase
      .from('qr_codes')
      .select('id, code, order_id')
      .or(`code.eq.${qr_code},code.eq.${baseCode}`)
      .maybeSingle()

    if (!qrCodeData) {
      return NextResponse.json(
        { success: false, error: 'QR code not found' },
        { status: 404 }
      )
    }

    // Check if gift exists and is available
    const { data: gift, error: giftError } = await supabase
      .from('redeem_gifts')
      .select('*')
      .eq('id', gift_id)
      .eq('is_active', true)
      .single()

    if (giftError || !gift) {
      return NextResponse.json(
        { success: false, error: 'Gift not found or inactive' },
        { status: 404 }
      )
    }

    // Check if gift has quantity limit and if it's exceeded
    if (gift.total_quantity > 0 && gift.claimed_quantity >= gift.total_quantity) {
      return NextResponse.json(
        { success: false, error: 'This gift has been fully claimed' },
        { status: 400 }
      )
    }

    // Check if consumer has already claimed this gift (if limit_per_consumer is set)
    if (consumer_phone && gift.limit_per_consumer) {
      const { count, error: checkError } = await supabase
        .from('consumer_qr_scans')
        .select('id', { count: 'exact', head: true })
        .eq('qr_code_id', qrCodeData.id)
        .eq('consumer_phone', consumer_phone)
        .eq('redeemed_gift', true)

      if (checkError) {
        console.error('Error checking consumer claims:', checkError)
      } else if (count && count >= gift.limit_per_consumer) {
        return NextResponse.json(
          { success: false, error: 'You have already claimed this gift' },
          { status: 400 }
        )
      }
    }

    // Increment claimed_quantity
    const { error: updateError } = await supabase
      .from('redeem_gifts')
      .update({ 
        claimed_quantity: gift.claimed_quantity + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', gift_id)

    if (updateError) {
      console.error('Error updating gift quantity:', updateError)
      return NextResponse.json(
        { success: false, error: 'Failed to claim gift' },
        { status: 500 }
      )
    }

    // Update or create consumer_qr_scans record
    if (consumer_phone) {
      // Check if scan record exists
      const { data: existingScan } = await supabase
        .from('consumer_qr_scans')
        .select('id')
        .eq('qr_code_id', qrCodeData.id)
        .eq('consumer_phone', consumer_phone)
        .maybeSingle()

      if (existingScan) {
        // Update existing record
        await supabase
          .from('consumer_qr_scans')
          .update({ 
            redeemed_gift: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingScan.id)
      } else {
        // Create new record
        await supabase
          .from('consumer_qr_scans')
          .insert({
            qr_code_id: qrCodeData.id,
            consumer_phone: consumer_phone,
            redeemed_gift: true,
            scanned_at: new Date().toISOString()
          })
      }
    }

    // Generate redemption code
    const redemptionCode = `GFT-${Date.now().toString(36).toUpperCase().substr(-6)}`

    return NextResponse.json({
      success: true,
      redemption_code: redemptionCode,
      gift_name: gift.gift_name,
      gift_description: gift.gift_description,
      gift_image_url: gift.gift_image_url,
      remaining: gift.total_quantity > 0 ? gift.total_quantity - gift.claimed_quantity - 1 : null
    })

  } catch (error) {
    console.error('Error in claim-gift API:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
