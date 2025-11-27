import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveQrCodeRecord, checkPointsCollected, calculateShopTotalPoints } from '@/lib/utils/qr-resolver'

/**
 * GET /api/consumer/check-collection-status
 * Check if points have already been collected for a QR code
 * 
 * Query params:
 *   qr_code: string - The QR code to check
 * 
 * Returns:
 *   already_collected: boolean
 *   points_earned: number (if collected)
 *   total_balance: number (if collected)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const qr_code = searchParams.get('qr_code')

    if (!qr_code) {
      return NextResponse.json(
        { success: false, error: 'QR code is required' },
        { status: 400 }
      )
    }

    // Use service role client to bypass RLS and ensure we can check status reliably
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

    console.log('🔍 Checking collection status for QR code:', qr_code)

    // Step 1: Resolve QR code record (handles both new codes with hash and legacy codes)
    const qrCodeData = await resolveQrCodeRecord(supabase, qr_code)

    if (!qrCodeData) {
      console.log('⚠️ QR code not found in database (preview mode)')
      // QR code not in database - return not collected
      return NextResponse.json({
        success: true,
        already_collected: false
      })
    }

    console.log('✅ Found QR code in database, ID:', qrCodeData.id)

    // Step 2: Check if points already collected for this QR code
    const collectionData = await checkPointsCollected(supabase, qrCodeData.id)

    // Step 3: Check if gift already redeemed
    const { data: giftRedemption } = await supabase
      .from('consumer_qr_scans')
      .select('id')
      .eq('qr_code_id', qrCodeData.id)
      .eq('redeemed_gift', true)
      .limit(1)
      .maybeSingle()

    // Step 4: Check if lucky draw entered
    const { data: luckyDrawEntry } = await supabase
      .from('lucky_draw_entries')
      .select('id')
      .eq('qr_code_id', qrCodeData.id)
      .limit(1)
      .maybeSingle()

    let totalBalance = 0
    if (collectionData) {
      console.log('✅ Found collection record:', collectionData)
      const shopId = collectionData.shop_id
      if (shopId) {
        totalBalance = await calculateShopTotalPoints(supabase, shopId)
      } else {
        totalBalance = collectionData.points_amount || 0
      }
    } else {
      console.log('✅ No collection records found - points not collected yet')
    }

    return NextResponse.json({
      success: true,
      already_collected: !!collectionData,
      points_earned: collectionData?.points_amount || 0,
      total_balance: totalBalance,
      gift_redeemed: !!giftRedemption,
      lucky_draw_entered: !!luckyDrawEntry
    })

  } catch (error) {
    console.error('❌ Error in check-collection-status:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
