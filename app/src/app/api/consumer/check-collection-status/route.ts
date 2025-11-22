import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

    const supabase = await createClient()

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

    if (!collectionData) {
      console.log('✅ No collection records found - points not collected yet')
      // No collection records found
      return NextResponse.json({
        success: true,
        already_collected: false
      })
    }

    console.log('✅ Found collection record:', collectionData)

    // Step 3: Points already collected - calculate total balance for this shop
    const shopId = collectionData.shop_id
    if (!shopId) {
      return NextResponse.json({
        success: true,
        already_collected: true,
        points_earned: collectionData.points_amount || 0,
        total_balance: collectionData.points_amount || 0
      })
    }

    const totalBalance = await calculateShopTotalPoints(supabase, shopId)

    return NextResponse.json({
      success: true,
      already_collected: true,
      points_earned: collectionData.points_amount || 0,
      total_balance: totalBalance
    })

  } catch (error) {
    console.error('❌ Error in check-collection-status:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
