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
          points_collected: 0,
          scratch_card_plays: 0
        }
      })
    }

    const batchIds = batches.map(b => b.id)
    
    console.log(`🔍 Looking for QR codes in batches:`, batchIds)

    // Get ALL QR codes for this order by order_id (most reliable method)
    // Valid Links = All QR codes generated for this order
    const { data: allQrCodes, error: qrError } = await supabase
      .from('qr_codes')
      .select('id, code, master_code_id, order_id')
      .eq('order_id', orderId)

    if (qrError) {
      console.error('❌ Error fetching QR codes:', qrError)
    }

    console.log(`📦 Found ${allQrCodes?.length || 0} QR codes for order`)
    
    const qrCodeIds = allQrCodes?.map(qr => qr.id) || []
    const totalValidLinks = allQrCodes?.length || 0
    
    console.log(`✅ Total valid links: ${totalValidLinks}, QR code IDs count: ${qrCodeIds.length}`)

    // Use database function to efficiently get all stats
    // This avoids the "Bad Request" error from large IN clauses with 1000+ QR codes
    const { data: statsData, error: statsError } = await supabase
      .rpc('get_consumer_scan_stats', { p_order_id: orderId })
      .single()

    if (statsError) {
      console.error('❌ Error fetching consumer scan stats:', statsError)
      // Return zeros if function fails
      return NextResponse.json({
        success: true,
        data: {
          total_valid_links: totalValidLinks,
          links_scanned: 0,
          lucky_draw_entries: 0,
          redemptions: 0,
          points_collected: 0,
          scratch_card_plays: 0
        }
      })
    }

    // Fetch scratch card plays count separately since it's not in the RPC yet
    let scratchCardPlaysCount = 0
    try {
      const { count, error: scratchError } = await supabase
        .from('scratch_card_plays')
        .select('id, qr_codes!inner(order_id)', { count: 'exact', head: true })
        .eq('qr_codes.order_id', orderId)
      
      if (!scratchError) {
        scratchCardPlaysCount = count || 0
      } else {
        console.error('Error fetching scratch card plays:', scratchError)
      }
    } catch (e) {
      console.error('Exception fetching scratch card plays:', e)
    }

    console.log(`📊 Stats for order ${orderId}:`, {
      total_qr_codes: statsData?.total_qr_codes || 0,
      unique_consumer_scans: statsData?.unique_consumer_scans || 0,
      points_collected_count: statsData?.points_collected_count || 0,
      lucky_draw_entries: statsData?.lucky_draw_entries || 0,
      redemptions: statsData?.redemptions || 0,
      scratch_card_plays: scratchCardPlaysCount
    })

    return NextResponse.json({
      success: true,
      data: {
        total_valid_links: Number(statsData?.total_qr_codes || 0),
        links_scanned: Number(statsData?.unique_consumer_scans || 0),
        lucky_draw_entries: Number(statsData?.lucky_draw_entries || 0),
        redemptions: Number(statsData?.redemptions || 0),
        points_collected: Number(statsData?.points_collected_count || 0),
        scratch_card_plays: scratchCardPlaysCount
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
