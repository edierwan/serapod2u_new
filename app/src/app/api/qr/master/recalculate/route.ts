import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Recalculate Master Case Statistics API
 * 
 * This endpoint recalculates actual_unit_count and status for master cases.
 * Useful for fixing masters with incorrect counts without manual DB edits.
 * 
 * Usage:
 * POST /api/qr/master/recalculate
 * Body: { master_code_id: "uuid" } OR { order_no: "ORD-...", case_number: 1 }
 * 
 * Returns: Updated master stats
 */

/**
 * Recalculate and update master case statistics
 * (Duplicated from worker - consider extracting to shared utility)
 */
async function recalculateMasterCaseStats(supabase: any, masterId: string) {
  // Get master code details
  const { data: master, error: masterError } = await supabase
    .from('qr_master_codes')
    .select('id, master_code, case_number, expected_unit_count, batch_id, qr_batches(order_id, orders(order_no))')
    .eq('id', masterId)
    .single()

  if (masterError || !master) {
    throw new Error(`Master code not found: ${masterId}`)
  }

  const expectedCount = Number(master.expected_unit_count || 0)
  const batchInfo = Array.isArray(master.qr_batches) ? master.qr_batches[0] : master.qr_batches
  const orderId = batchInfo?.order_id
  const orderNo = batchInfo?.orders?.order_no || (Array.isArray(batchInfo?.orders) ? batchInfo.orders[0]?.order_no : null)

  // Count ALL codes linked to this master (excluding spoiled)
  const { count: actualCount, error: countError } = await supabase
    .from('qr_codes')
    .select('id', { count: 'exact', head: true })
    .eq('master_code_id', master.id)
    .neq('status', 'spoiled')

  if (countError) {
    throw new Error(`Failed to count codes for master ${master.master_code}: ${countError.message}`)
  }

  const finalCount = actualCount || 0
  const newStatus = finalCount >= expectedCount ? 'packed' : (finalCount > 0 ? 'partial' : 'generated')

  // Update master code
  const { error: updateError } = await supabase
    .from('qr_master_codes')
    .update({
      actual_unit_count: finalCount,
      status: newStatus,
      updated_at: new Date().toISOString()
    })
    .eq('id', master.id)

  if (updateError) {
    throw new Error(`Failed to update master ${master.master_code}: ${updateError.message}`)
  }

  // Log for observability
  console.log(`[ModeC] Master sync: case ${master.case_number}, expected ${expectedCount}, counted ${finalCount} (${newStatus}), master_id=${master.id}, order=${orderNo}`)

  // Warning if count is 0 but we expected codes
  if (finalCount === 0 && expectedCount > 0) {
    console.warn(`⚠️ Master case ${master.case_number} has 0 codes linked but expected ${expectedCount}. Master: ${master.master_code}, Order: ${orderNo || 'unknown'}`)
  }

  return {
    master_code: master.master_code,
    case_number: master.case_number,
    expected_unit_count: expectedCount,
    actual_unit_count: finalCount,
    status: newStatus,
    order_id: orderId,
    order_no: orderNo
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()

    const { master_code_id, order_no, case_number } = body

    let masterId: string

    if (master_code_id) {
      // Direct master ID provided
      masterId = master_code_id
      console.log(`🔄 Recalculating master by ID: ${masterId}`)
    } else if (order_no && case_number) {
      // Lookup master by order + case number
      console.log(`🔍 Looking up master for order ${order_no}, case ${case_number}`)
      
      const { data: order } = await supabase
        .from('orders')
        .select('id')
        .eq('order_no', order_no)
        .single()

      if (!order) {
        return NextResponse.json(
          { error: `Order not found: ${order_no}` },
          { status: 404 }
        )
      }

      const { data: batch } = await supabase
        .from('qr_batches')
        .select('id')
        .eq('order_id', order.id)
        .single()

      if (!batch) {
        return NextResponse.json(
          { error: `Batch not found for order: ${order_no}` },
          { status: 404 }
        )
      }

      const { data: master } = await supabase
        .from('qr_master_codes')
        .select('id')
        .eq('batch_id', batch.id)
        .eq('case_number', case_number)
        .single()

      if (!master) {
        return NextResponse.json(
          { error: `Master case not found: ${order_no}, case ${case_number}` },
          { status: 404 }
        )
      }

      masterId = master.id
      console.log(`   ✅ Found master: ${masterId}`)
    } else {
      return NextResponse.json(
        { error: 'Must provide either master_code_id OR (order_no + case_number)' },
        { status: 400 }
      )
    }

    // Recalculate stats
    const stats = await recalculateMasterCaseStats(supabase, masterId)

    return NextResponse.json({
      success: true,
      message: 'Master case statistics recalculated successfully',
      stats
    })

  } catch (error: any) {
    console.error('❌ Recalculation error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to recalculate master statistics' },
      { status: 500 }
    )
  }
}
