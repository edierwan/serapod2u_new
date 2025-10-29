import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Get QR code statistics for a journey (order)
 * GET /api/journey/qr-stats?order_id=xxx
 * 
 * Returns:
 * - total_valid_links: Total QR codes generated for this order
 * - links_scanned: QR codes that have been scanned
 * - lucky_draw_entries: Number of lucky draw entries from this order's QR codes
 * - redemptions: Number of redemptions from this order's QR codes
 * - points_collected: Total points collected from scans
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const searchParams = request.nextUrl.searchParams
    const orderId = searchParams.get('order_id')

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'Order ID is required' },
        { status: 400 }
      )
    }

    // Get the batch for this order
    const { data: batches, error: batchError } = await supabase
      .from('qr_batches')
      .select('id, total_unique_codes')
      .eq('order_id', orderId)

    if (batchError) {
      console.error('Error fetching batches:', batchError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch batch data' },
        { status: 500 }
      )
    }

    if (!batches || batches.length === 0) {
      // No batch yet - return zeros
      return NextResponse.json({
        success: true,
        data: {
          total_valid_links: 0,
          links_scanned: 0,
          lucky_draw_entries: 0,
          redemptions: 0,
          points_collected: 0
        }
      })
    }

    const batchIds = batches.map(b => b.id)
    const totalValidLinks = batches.reduce((sum, b) => sum + (Number(b.total_unique_codes) || 0), 0)

    // Get all QR code IDs for these batches first
    const { data: qrCodes, error: qrError } = await supabase
      .from('qr_codes')
      .select('id')
      .in('batch_id', batchIds)

    if (qrError) {
      console.error('Error fetching QR codes:', qrError)
    }

    const qrCodeIds = qrCodes?.map(qr => qr.id) || []

    // Initialize counters
    let uniqueConsumerScans = 0
    let luckyDrawCount = 0
    let redemptionCount = 0
    let pointsCollected = 0

    if (qrCodeIds.length > 0) {
      // Get CONSUMER scans count (not manufacturer scans)
      // This counts unique QR codes that consumers have scanned
      const { data: consumerScans, error: consumerError } = await supabase
        .from('consumer_qr_scans')
        .select('qr_code_id')
        .in('qr_code_id', qrCodeIds)

      if (consumerError) {
        console.error('Error counting consumer scans:', consumerError)
      } else if (consumerScans) {
        // Count unique QR codes scanned by consumers
        uniqueConsumerScans = new Set(consumerScans.map(s => s.qr_code_id)).size
      }

      // Get lucky draw entries
      const { count: luckyCount, error: luckyError } = await supabase
        .from('lucky_draw_entries')
        .select('*', { count: 'exact', head: true })
        .in('qr_code_id', qrCodeIds)

      if (!luckyError) {
        luckyDrawCount = luckyCount || 0
      }

      // Get redemptions
      const { count: redeemCount, error: redeemError } = await supabase
        .from('consumer_redemption_transactions')
        .select('*', { count: 'exact', head: true })
        .in('qr_code_id', qrCodeIds)

      if (!redeemError) {
        redemptionCount = redeemCount || 0
      }

      // Get points collected
      const { data: pointsData, error: pointsError } = await supabase
        .from('consumer_points_transactions')
        .select('points_amount')
        .in('qr_code_id', qrCodeIds)
        .eq('transaction_type', 'earn')

      if (!pointsError && pointsData) {
        pointsCollected = pointsData.reduce((sum, t) => sum + (Number(t.points_amount) || 0), 0)
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        total_valid_links: totalValidLinks,
        links_scanned: uniqueConsumerScans,
        lucky_draw_entries: luckyDrawCount,
        redemptions: redemptionCount,
        points_collected: pointsCollected
      }
    })

  } catch (error: any) {
    console.error('Error fetching QR statistics:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
