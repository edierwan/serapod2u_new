import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const searchParams = request.nextUrl.searchParams
    const orderId = searchParams.get('order_id')
    const batchId = searchParams.get('batch_id')
    const manufacturerId = searchParams.get('manufacturer_id')

    // Get user's organization
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Build query conditions
    let query = supabase
      .from('qr_batches')
      .select(`
        id,
        order_id,
        total_master_codes,
        total_unique_codes,
        buffer_percent,
        status,
        created_at,
        orders (
          id,
          order_no,
          buyer_org_id,
          seller_org_id,
          status,
          organizations!orders_buyer_org_id_fkey (
            org_name,
            org_type_code
          )
        )
      `)
      .order('created_at', { ascending: false })

    if (orderId) {
      query = query.eq('order_id', orderId)
    }

    if (batchId) {
      query = query.eq('id', batchId)
    }

    const { data: batches, error: batchError } = await query

    if (batchError) {
      throw batchError
    }

    // For each batch, get packing progress
    const batchesWithProgress = await Promise.all(
      (batches || []).map(async (batch) => {
        // Get total master codes count
        const { count: totalMasters } = await supabase
          .from('qr_master_codes')
          .select('*', { count: 'exact', head: true })
          .eq('batch_id', batch.id)

        // Get master codes for this batch
        const { data: masterCodesData } = await supabase
          .from('qr_master_codes')
          .select('id, case_number, expected_unit_count, actual_unit_count, status')
          .eq('batch_id', batch.id)

        // Count actual linked QR codes per master (restrict to packed-like statuses)
        // Include 'ready_to_ship' status - set by Production Complete button
        // Include 'buffer_used' status - set by Mode C before updating to 'packed'
        const { data: qrCodesForMasters } = await supabase
          .from('qr_codes')
          .select('master_code_id, status, sequence_number')
          .eq('batch_id', batch.id)
          .in('status', ['packed', 'buffer_used', 'ready_to_ship', 'received_warehouse', 'shipped_distributor', 'opened'])
          .not('master_code_id', 'is', null)

        const masterLinkedCounts = new Map<string, number>()
          ; (qrCodesForMasters || []).forEach((qr) => {
            const masterId = qr.master_code_id as string | null
            if (!masterId) return
            masterLinkedCounts.set(masterId, (masterLinkedCounts.get(masterId) || 0) + 1)
          })

        const totalUniqueWithBuffer = batch.total_unique_codes || 0
        const bufferPercent = Number(batch.buffer_percent ?? 0)
        const plannedUniqueCodes = bufferPercent > 0
          ? Math.round(totalUniqueWithBuffer / (1 + bufferPercent / 100))
          : totalUniqueWithBuffer
        const totalBufferCodes = Math.max(totalUniqueWithBuffer - plannedUniqueCodes, 0)

        // CORRECT: Count buffers by checking is_buffer flag and status
        // Query all buffer codes for this batch
        const { data: allBufferCodes } = await supabase
          .from('qr_codes')
          .select('id, status, is_buffer, sequence_number')
          .eq('batch_id', batch.id)
          .eq('is_buffer', true)
        
        const usedBufferCodes = (allBufferCodes || []).filter(qr => qr.status === 'buffer_used').length
        
        // Calculate total buffer codes from batch metadata
        const actualTotalBuffers = totalBufferCodes // Use calculated buffer from total - planned
        
        // Available buffers = expected - total_linked for all cases
        // This accounts for codes that are not yet packed but reserved
        const totalExpectedUnits = (masterCodesData || []).reduce((sum, mc) => sum + Number(mc.expected_unit_count || 0), 0)
        const totalLinkedUnits = Array.from(masterLinkedCounts.values()).reduce((sum, count) => sum + count, 0)
        const calculatedAvailableBuffers = Math.max(totalExpectedUnits - totalLinkedUnits, 0)
        
        const availableBufferCodes = calculatedAvailableBuffers

        const packedMasters = (masterCodesData || []).filter((mc) => {
          const expected = Number(mc.expected_unit_count || 0)
          if (!expected) return false
          
          // Prioritize actual_unit_count (reliable, set by mark-case-perfect API)
          // Fall back to counting linked QR codes only if actual_unit_count is not set
          const actualCount = Number(mc.actual_unit_count || 0)
          const linkedCount = actualCount > 0 ? actualCount : (masterLinkedCounts.get(mc.id) || 0)
          
          return linkedCount >= expected
        }).length

        // Get packed unique codes count (includes 'ready_to_ship' and 'buffer_used' status)
        const { count: packedUniquesRaw } = await supabase
          .from('qr_codes')
          .select('*', { count: 'exact', head: true })
          .eq('batch_id', batch.id)
          .in('status', ['packed', 'buffer_used', 'ready_to_ship', 'received_warehouse', 'shipped_distributor', 'opened'])

        // Count master codes that have left manufacturer (warehouse and beyond)
        const { count: warehouseReceivedMasters } = await supabase
          .from('qr_master_codes')
          .select('*', { count: 'exact', head: true })
          .eq('batch_id', batch.id)
          .in('status', ['received_warehouse', 'shipped_distributor', 'opened'])

        const packedUniquesForProgress = Math.min(packedUniquesRaw || 0, plannedUniqueCodes)


        // Get latest scan activity
        const { data: latestScans } = await supabase
          .from('qr_codes')
          .select('last_scanned_at, last_scanned_by')
          .eq('batch_id', batch.id)
          .not('last_scanned_at', 'is', null)
          .order('last_scanned_at', { ascending: false })
          .limit(5)

        const mastersProgress = totalMasters ? (packedMasters || 0) / totalMasters * 100 : 0
        const uniquesProgress = plannedUniqueCodes
          ? (packedUniquesForProgress / plannedUniqueCodes) * 100
          : 0
        const overallProgress = (mastersProgress + uniquesProgress) / 2

        const orderData = Array.isArray(batch.orders) ? batch.orders[0] : batch.orders
        const orgData = orderData ? (Array.isArray(orderData.organizations) ? orderData.organizations[0] : orderData.organizations) : null

        // Generate batch code from order number or batch ID
        const batchCode = orderData?.order_no
          ? `BATCH-${orderData.order_no}`
          : `BATCH-${batch.id.substring(0, 8).toUpperCase()}`

        // Get detailed case-by-case status
        const caseDetails = (masterCodesData || []).map((mc) => {
          const expected = Number(mc.expected_unit_count || 0)
          
          // Prioritize actual_unit_count (reliable, set by mark-case-perfect API and Mode C worker)
          // Fall back to counting linked QR codes only if actual_unit_count is not set
          const actualCount = Number(mc.actual_unit_count || 0)
          const linkedCount = actualCount > 0 ? actualCount : (masterLinkedCounts.get(mc.id) || 0)
          
          // A case is packed if:
          // 1. It has reached the expected count, OR
          // 2. The master status is 'packed' (set by Mode C worker or mark-case-perfect)
          const isPacked = (expected > 0 && linkedCount >= expected) || mc.status === 'packed'

          return {
            case_number: mc.case_number,
            expected_units: expected,
            actual_units: linkedCount,
            status: mc.status,
            is_packed: isPacked,
            percentage: expected > 0 ? Math.round((linkedCount / expected) * 100) : 0
          }
        }).sort((a: any, b: any) => a.case_number - b.case_number)

        // Group cases by status for quick summary
        const packedCases = caseDetails.filter((c: any) => c.is_packed).map((c: any) => c.case_number)
        const partialCases = caseDetails.filter((c: any) => !c.is_packed && c.actual_units > 0).map((c: any) => c.case_number)
        const emptyCases = caseDetails.filter((c: any) => c.actual_units === 0).map((c: any) => c.case_number)

        return {
          batch_id: batch.id,
          batch_code: batchCode,
          batch_status: batch.status,
          order_id: batch.order_id,
          order_no: orderData?.order_no || '',
          buyer_org_name: orgData?.org_name || 'Unknown',
          total_master_codes: totalMasters || 0,
          packed_master_codes: packedMasters || 0,
          total_unique_codes: plannedUniqueCodes,
          planned_unique_codes: plannedUniqueCodes,
          total_unique_with_buffer: totalUniqueWithBuffer,
          packed_unique_codes: packedUniquesForProgress,
          actual_packed_unique_codes: packedUniquesRaw || 0,
          total_buffer_codes: actualTotalBuffers || 0, // Actual total from database
          used_buffer_codes: usedBufferCodes || 0,
          available_buffer_codes: availableBufferCodes || 0,
          master_progress_percentage: Math.round(mastersProgress),
          unique_progress_percentage: Math.round(uniquesProgress),
          overall_progress_percentage: Math.round(overallProgress),
          warehouse_started: (warehouseReceivedMasters || 0) > 0,
          warehouse_received_cases: warehouseReceivedMasters || 0,
          is_complete: (packedMasters === totalMasters) && (packedUniquesForProgress === plannedUniqueCodes),
          latest_scans: latestScans || [],
          created_at: batch.created_at,
          // Case-by-case breakdown
          case_details: caseDetails,
          packed_case_numbers: packedCases,
          partial_case_numbers: partialCases,
          empty_case_numbers: emptyCases
        }
      })
    )

    // Get overall stats for manufacturer
    const { count: totalOrdersCount } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('seller_org_id', manufacturerId || user.id)
      .eq('status', 'approved')

    const { count: totalBatchesCount } = await supabase
      .from('qr_batches')
      .select('*, orders!inner(*)', { count: 'exact', head: true })
      .eq('orders.seller_org_id', manufacturerId || user.id)

    return NextResponse.json({
      success: true,
      batches: batchesWithProgress,
      summary: {
        total_orders: totalOrdersCount || 0,
        total_batches: totalBatchesCount || 0,
        total_batches_shown: batchesWithProgress.length,
        complete_batches: batchesWithProgress.filter(b => b.is_complete).length,
        in_progress_batches: batchesWithProgress.filter(b => !b.is_complete && b.packed_unique_codes > 0).length
      }
    })
  } catch (error: any) {
    console.error('Error fetching batch progress:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch batch progress' },
      { status: 500 }
    )
  }
}
