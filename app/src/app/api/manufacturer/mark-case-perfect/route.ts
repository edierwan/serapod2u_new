import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Mark Case Perfect - Auto-link all codes for a perfect case
 * 
 * Use this when a case has NO damaged/spoiled codes.
 * User only scans the master case QR, and system automatically links
 * all codes in that case's sequence range without individual scanning.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { master_code, manufacturer_org_id, user_id, order_id } = body

    console.log('✨ Mark case perfect request:', { 
      master_code, 
      manufacturer_org_id,
      user_id,
      order_id
    })

    if (!master_code) {
      return NextResponse.json(
        { error: 'Master code is required' },
        { status: 400 }
      )
    }

    // Extract master code from URL if needed
    let masterCodeToScan = master_code.trim()
    if (masterCodeToScan.includes('/track/')) {
      const parts = masterCodeToScan.split('/')
      masterCodeToScan = parts[parts.length - 1]
    }

    // Find master code in database with order info for validation
    const { data: masterCodeRecord, error: masterError } = await supabase
      .from('qr_master_codes')
      .select(`
        *,
        qr_batches!inner(
          order_id,
          orders!inner(order_no)
        )
      `)
      .eq('master_code', masterCodeToScan)
      .single()

    if (masterError || !masterCodeRecord) {
      console.error('❌ Master code not found:', masterError)
      return NextResponse.json(
        { error: 'Master code not found in system' },
        { status: 404 }
      )
    }

    // CRITICAL: Validate that the master code belongs to the selected order
    const masterBatch = Array.isArray(masterCodeRecord.qr_batches) 
      ? masterCodeRecord.qr_batches[0] 
      : masterCodeRecord.qr_batches
    const masterOrderId = masterBatch?.order_id
    const masterOrderNo = masterBatch?.orders ? 
      (Array.isArray(masterBatch.orders) ? masterBatch.orders[0]?.order_no : masterBatch.orders?.order_no) 
      : null

    if (order_id && masterOrderId !== order_id) {
      // Get current order number for better error message
      const { data: currentOrder } = await supabase
        .from('orders')
        .select('order_no')
        .eq('id', order_id)
        .single()

      const currentOrderNo = currentOrder?.order_no || order_id.substring(0, 8)
      const wrongOrderDisplay = masterOrderNo || masterOrderId?.substring(0, 8)

      console.warn('⚠️ Wrong order detected:', {
        expected_order: order_id,
        expected_order_no: currentOrderNo,
        master_order: masterOrderId,
        master_order_no: masterOrderNo
      })

      return NextResponse.json(
        { 
          error: 'WRONG_ORDER',
          message: `❌ Wrong Order!\n\nThis master case belongs to ${wrongOrderDisplay}, but you are currently working on ${currentOrderNo}.\n\nYou cannot mark cases from other orders as perfect. Please scan master cases from ${currentOrderNo} only.`
        },
        { status: 400 }
      )
    }

    console.log('📦 Master code found:', {
      id: masterCodeRecord.id,
      case_number: masterCodeRecord.case_number,
      expected_unit_count: masterCodeRecord.expected_unit_count,
      current_actual_count: masterCodeRecord.actual_unit_count,
      status: masterCodeRecord.status,
      order_id: masterOrderId,
      order_no: masterOrderNo
    })

    // Check if case is already marked perfect/packed
    if (masterCodeRecord.status === 'packed' && 
        (masterCodeRecord.actual_unit_count ?? 0) >= masterCodeRecord.expected_unit_count) {
      console.log('✅ Case already marked perfect')
      return NextResponse.json({
        success: true,
        message: 'Case already marked perfect',
        linked_count: masterCodeRecord.actual_unit_count,
        master_code_info: {
          id: masterCodeRecord.id,
          master_code: masterCodeRecord.master_code,
          case_number: masterCodeRecord.case_number,
          expected_units: masterCodeRecord.expected_unit_count,
          actual_units: masterCodeRecord.actual_unit_count,
          status: masterCodeRecord.status
        },
        already_complete: true
      })
    }

    // Calculate sequence range for this case
    const caseNumber = masterCodeRecord.case_number
    const expectedUnits = masterCodeRecord.expected_unit_count
    const minSequence = ((caseNumber - 1) * expectedUnits) + 1
    const maxSequence = caseNumber * expectedUnits

    console.log('🔢 Sequence range for Case #' + caseNumber + ':', {
      min: minSequence,
      max: maxSequence,
      total_expected: expectedUnits
    })

    // Get batch and order info
    const { data: batchInfo, error: batchInfoError } = await supabase
      .from('qr_batches')
      .select(`
        id,
        order_id,
        orders (
          id,
          order_no,
          buyer_org_id,
          seller_org_id
        )
      `)
      .eq('id', masterCodeRecord.batch_id)
      .maybeSingle()

    if (batchInfoError) {
      console.error('❌ Failed to load batch info:', batchInfoError)
      throw batchInfoError
    }

    const orderRecord = batchInfo?.orders
      ? (Array.isArray(batchInfo.orders) ? batchInfo.orders[0] : batchInfo.orders)
      : null
    const targetWarehouseOrgId = orderRecord?.buyer_org_id || null

    // Find all QR codes in this case's sequence range
    const { data: caseCodes, error: caseCodesError } = await supabase
      .from('qr_codes')
      .select('id, code, sequence_number, master_code_id, status, variant_id, last_scanned_by, last_scanned_at')
      .eq('batch_id', masterCodeRecord.batch_id)
      .gte('sequence_number', minSequence)
      .lte('sequence_number', maxSequence)
      .order('sequence_number')

    if (caseCodesError) {
      console.error('❌ Failed to fetch case codes:', caseCodesError)
      throw caseCodesError
    }

    console.log('📊 Found codes in sequence range:', {
      total_found: caseCodes?.length || 0,
      expected: expectedUnits,
      match: caseCodes?.length === expectedUnits
    })

    // Validation: Check if we found exactly the expected number
    if (!caseCodes || caseCodes.length === 0) {
      return NextResponse.json(
        { 
          error: `No QR codes found in sequence range ${minSequence}-${maxSequence}. Case may not have been generated yet.`,
          expected_range: { min: minSequence, max: maxSequence },
          found_count: 0
        },
        { status: 400 }
      )
    }

    if (caseCodes.length !== expectedUnits) {
      return NextResponse.json(
        { 
          error: `Expected ${expectedUnits} codes but found ${caseCodes.length} in range ${minSequence}-${maxSequence}. Case may be incomplete.`,
          expected_count: expectedUnits,
          found_count: caseCodes.length,
          expected_range: { min: minSequence, max: maxSequence }
        },
        { status: 400 }
      )
    }

    // CRITICAL: Check if this case has been worked on by workers
    // Check if any codes in this case have been individually scanned by workers
    // last_scanned_by will be populated if workers manually scanned the codes
    // "Mark Perfect" should ONLY be used for truly perfect cases with NO worker intervention
    const codesWithWorkerScans = caseCodes.filter(qr => qr.last_scanned_by !== null)
    
    if (codesWithWorkerScans.length > 0) {
      console.warn('⚠️ Case has worker scan history - cannot use Mark Perfect')
      console.log('Codes scanned by workers:', codesWithWorkerScans.map(qr => ({
        code: qr.code,
        sequence: qr.sequence_number,
        scanned_by: qr.last_scanned_by
      })))
      
      return NextResponse.json(
        { 
          error: 'WORKER_PROCESSED',
          message: 'This case has already been processed by workers using the scanning system. Mark Perfect can only be used for cases that have never been scanned by workers.',
          has_worker_scans: true,
          worker_scanned_count: codesWithWorkerScans.length,
          total_codes: caseCodes.length
        },
        { status: 400 }
      )
    }

    // Check for already-linked codes
    const alreadyLinked = caseCodes.filter(qr => qr.master_code_id !== null)
    if (alreadyLinked.length > 0) {
      // If ALL codes are already linked to THIS master, treat as success
      const allLinkedToThisMaster = alreadyLinked.every(qr => qr.master_code_id === masterCodeRecord.id)
      
      if (allLinkedToThisMaster && alreadyLinked.length === caseCodes.length) {
        console.log('✅ All codes already linked to this master case')
        return NextResponse.json({
          success: true,
          message: 'Case already marked perfect (all codes linked)',
          linked_count: caseCodes.length,
          master_code_info: {
            id: masterCodeRecord.id,
            master_code: masterCodeRecord.master_code,
            case_number: masterCodeRecord.case_number,
            expected_units: masterCodeRecord.expected_unit_count,
            actual_units: caseCodes.length,
            status: 'packed'
          },
          already_complete: true
        })
      }

      // Some codes linked to different masters - this is an error
      const linkedToDifferent = alreadyLinked.filter(qr => qr.master_code_id !== masterCodeRecord.id)
      if (linkedToDifferent.length > 0) {
        return NextResponse.json(
          { 
            error: `${linkedToDifferent.length} code(s) already linked to different master cases. Cannot mark as perfect.`,
            already_linked_count: linkedToDifferent.length,
            codes_sample: linkedToDifferent.slice(0, 5).map(qr => ({
              code: qr.code,
              sequence: qr.sequence_number
            }))
          },
          { status: 400 }
        )
      }
    }

    // Get available codes (not yet linked)
    const availableCodes = caseCodes.filter(qr => qr.master_code_id === null)
    
    console.log('📊 Code status:', {
      total: caseCodes.length,
      already_linked_to_this_master: alreadyLinked.filter(qr => qr.master_code_id === masterCodeRecord.id).length,
      available_to_link: availableCodes.length
    })

    if (availableCodes.length === 0) {
      console.log('✅ No new codes to link - case already complete')
      return NextResponse.json({
        success: true,
        message: 'Case already complete',
        linked_count: caseCodes.length,
        master_code_info: {
          id: masterCodeRecord.id,
          master_code: masterCodeRecord.master_code,
          case_number: masterCodeRecord.case_number,
          expected_units: masterCodeRecord.expected_unit_count,
          actual_units: caseCodes.length,
          status: 'packed'
        },
        already_complete: true
      })
    }

    // Batch update all available QR codes
    const codeIdsToLink = availableCodes.map(qr => qr.id)
    
    console.log('📝 Linking codes to master:', {
      codes_to_link: codeIdsToLink.length,
      master_code_id: masterCodeRecord.id
    })

    const updateStart = Date.now()
    const { error: updateError } = await supabase
      .from('qr_codes')
      .update({
        master_code_id: masterCodeRecord.id,
        status: 'packed',
        last_scanned_at: new Date().toISOString(),
        last_scanned_by: user_id || null,
        current_location_org_id: manufacturer_org_id || null,
        updated_at: new Date().toISOString()
      })
      .in('id', codeIdsToLink)

    if (updateError) {
      console.error('❌ Failed to update QR codes:', updateError)
      throw updateError
    }

    console.log(`✅ Updated ${codeIdsToLink.length} codes in ${Date.now() - updateStart}ms`)

    // Update master code to packed status
    const newActualCount = (masterCodeRecord.actual_unit_count ?? 0) + availableCodes.length
    const masterUpdates: Record<string, any> = {
      actual_unit_count: newActualCount,
      status: 'packed',
      manufacturer_scanned_at: new Date().toISOString(),
      manufacturer_scanned_by: user_id || null,
      manufacturer_org_id: manufacturer_org_id || null,
      updated_at: new Date().toISOString()
    }

    if (targetWarehouseOrgId) {
      masterUpdates.warehouse_org_id = targetWarehouseOrgId
    }

    console.log('📝 Updating master code:', {
      id: masterCodeRecord.id,
      new_actual_count: newActualCount,
      status: 'packed',
      manufacturer_org_id,
      warehouse_org_id: masterUpdates.warehouse_org_id
    })

    const { error: masterUpdateError } = await supabase
      .from('qr_master_codes')
      .update(masterUpdates)
      .eq('id', masterCodeRecord.id)

    if (masterUpdateError) {
      console.error('❌ Failed to update master code:', masterUpdateError)
      throw masterUpdateError
    }

    console.log('✅ Master code marked as packed')

    // Update batch status to 'in_production' if needed
    if (masterCodeRecord.batch_id) {
      const { data: batchData } = await supabase
        .from('qr_batches')
        .select('status')
        .eq('id', masterCodeRecord.batch_id)
        .single()

      if (batchData && (batchData.status === 'printing' || batchData.status === 'generated')) {
        await supabase
          .from('qr_batches')
          .update({ 
            status: 'in_production',
            updated_at: new Date().toISOString()
          })
          .eq('id', masterCodeRecord.batch_id)

        console.log('✅ Batch status updated to "in_production"')
      }
    }

    const totalProcessingTime = Date.now() - updateStart
    console.log(`⚡ Total processing time: ${totalProcessingTime}ms`)
    console.log('✨ CASE MARKED PERFECT - All codes automatically linked!')

    return NextResponse.json({
      success: true,
      message: `Case #${caseNumber} marked perfect! All ${caseCodes.length} codes linked automatically.`,
      linked_count: availableCodes.length,
      master_code_info: {
        id: masterCodeRecord.id,
        master_code: masterCodeRecord.master_code,
        case_number: masterCodeRecord.case_number,
        expected_units: masterCodeRecord.expected_unit_count,
        actual_units: newActualCount,
        linked_this_session: availableCodes.length,
        status: 'packed',
        warehouse_org_id: masterUpdates.warehouse_org_id || null
      },
      sequence_range: {
        min: minSequence,
        max: maxSequence
      },
      performance: {
        processing_time_ms: totalProcessingTime,
        codes_per_second: Math.round((availableCodes.length / totalProcessingTime) * 1000)
      },
      order_info: orderRecord ? {
        order_id: orderRecord.id,
        order_no: orderRecord.order_no,
        buyer_org_id: orderRecord.buyer_org_id,
        seller_org_id: orderRecord.seller_org_id
      } : undefined
    })

  } catch (error: any) {
    console.error('❌ Error marking case perfect:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to mark case perfect' },
      { status: 500 }
    )
  }
}
