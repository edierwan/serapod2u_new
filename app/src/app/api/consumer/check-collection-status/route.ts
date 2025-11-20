import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBaseCode } from '@/lib/security/qr-hash'

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

    // Extract base code (remove hash suffix if present)
    const baseCode = getBaseCode(qr_code)

    console.log('🔍 Checking collection status for QR code:', qr_code)
    console.log('📋 Base code (without hash):', baseCode)

    // Look up QR code in database using base code (codes stored without hash)
    const { data: qrCodeData, error: qrError } = await supabase
      .from('qr_codes')
      .select('id, code')
      .eq('code', baseCode)
      .limit(1)
      .single()

    if (qrError || !qrCodeData) {
      console.log('⚠️ QR code not found in database:', qrError?.message)
      // QR code not in database - return not collected
      return NextResponse.json({
        success: true,
        already_collected: false
      })
    }

    console.log('✅ Found QR code in database, ID:', qrCodeData.id)

    // Check if there are any collection records for this QR code
    const { data: collectionData, error: collectionError } = await supabase
      .from('consumer_qr_scans')
      .select('points_amount, shop_id, points_collected_at')
      .eq('qr_code_id', qrCodeData.id)
      .eq('collected_points', true)
      .order('points_collected_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (collectionError) {
      console.error('❌ Error checking collection status:', collectionError)
      return NextResponse.json(
        { success: false, error: 'Database error' },
        { status: 500 }
      )
    }

    if (!collectionData) {
      console.log('❌ No collection records found for this QR code')
      // No collection records found
      return NextResponse.json({
        success: true,
        already_collected: false
      })
    }

    console.log('✅ Found collection record:', collectionData)

    // Points already collected - get total balance for this shop
    const shopId = collectionData.shop_id
    if (!shopId) {
      return NextResponse.json({
        success: true,
        already_collected: true,
        points_earned: collectionData.points_amount || 0,
        total_balance: collectionData.points_amount || 0
      })
    }

    const { data: allScans } = await supabase
      .from('consumer_qr_scans')
      .select('points_amount')
      .eq('shop_id', shopId)
      .eq('collected_points', true)

    const totalBalance = allScans?.reduce((sum, scan) => {
      return sum + (scan.points_amount || 0)
    }, 0) || 0

    return NextResponse.json({
      success: true,
      already_collected: true,
      points_earned: collectionData.points_amount || 0,
      total_balance: totalBalance
    })

  } catch (error) {
    console.error('Error in check-collection-status:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
