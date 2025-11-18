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
  const startTime = Date.now()
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

    console.log('🔍 Searching for master code:', masterCodeToScan)

    // PERFORMANCE CRITICAL: Use simple query without joins, then fetch related data only if needed
    let masterCodeRecord: any = null

    // Step 1: Try exact match (fastest - uses index, no joins)
    // PERFORMANCE: Select only required columns
    const { data: exactMatch } = await supabase
      .from('qr_master_codes')
      .select('id, master_code, batch_id, case_number, expected_unit_count, actual_unit_count, status, manufacturer_org_id')
      .eq('master_code', masterCodeToScan)
      .maybeSingle()

    if (exactMatch) {
      masterCodeRecord = exactMatch
    } else {
      // Step 2: Fallback to LIKE pattern for codes with hash suffix
      const { data: likeMatch } = await supabase
        .from('qr_master_codes')
        .select('id, master_code, batch_id, case_number, expected_unit_count, actual_unit_count, status, manufacturer_org_id')
        .like('master_code', `${masterCodeToScan}-%`)
        .limit(1)
        .maybeSingle()
      
      masterCodeRecord = likeMatch
    }

    if (!masterCodeRecord) {
      console.error('❌ Master code not found:', masterCodeToScan)
      return NextResponse.json(
        { error: 'Master code not found in system' },
        { status: 404 }
      )
    }

    // Fetch batch and order info separately (faster than joins)
    const { data: batchData } = await supabase
      .from('qr_batches')
      .select('order_id')
      .eq('id', masterCodeRecord.batch_id)
      .single()

    if (!batchData) {
      return NextResponse.json(
        { error: 'Batch not found for this master code' },
        { status: 404 }
      )
    }

    const masterOrderId = batchData.order_id

    // CRITICAL: Validate that the master code belongs to the selected order
    if (order_id && masterOrderId !== order_id) {
      // Fetch order numbers for error message
      const { data: orderData } = await supabase
        .from('orders')
        .select('id, order_no')
        .in('id', [order_id, masterOrderId])

      const orderMap = new Map(orderData?.map(o => [o.id, o.order_no]) || [])
      const currentOrderNo = orderMap.get(order_id) || order_id.substring(0, 8)
      const wrongOrderDisplay = orderMap.get(masterOrderId) || masterOrderId.substring(0, 8)

      console.warn('⚠️ Wrong order detected:', {
        expected_order: order_id,
        expected_order_no: currentOrderNo,
        master_order: masterOrderId,
        master_order_no: wrongOrderDisplay
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
      order_id: masterOrderId
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

    // Get case information
    const caseNumber = masterCodeRecord.case_number
    const expectedUnits = masterCodeRecord.expected_unit_count

    console.log('📦 Case #' + caseNumber + ':', {
      case_number: caseNumber,
      expected_units: expectedUnits
    })

    // Fetch buyer_org_id for warehouse assignment (if needed later)
    const { data: orderInfo } = await supabase
      .from('orders')
      .select('buyer_org_id, order_no')
      .eq('id', masterOrderId)
      .single()
    
    const targetWarehouseOrgId = orderInfo?.buyer_org_id || null
    
    console.log('📋 Order configuration:', {
      buyer_org_id: orderInfo?.buyer_org_id
    })

    // ============================================================================
    // CORRECT STRATEGY: Link by case_number (supports both normal and mixed cases)
    // ============================================================================
    // Get ALL non-buffer codes for this specific case_number
    // This automatically handles:
    // - Normal cases: 1 product per case
    // - Mixed cases: Multiple products in same case_number
    // - Variable sizes: Different expected_unit_count per case
    // ============================================================================
    
    console.log('🎯 Fetching codes by case_number (supports normal & mixed cases)')
    
    // PERFORMANCE: Select only required columns, remove ORDER BY (not needed for logic)
    const { data: caseCodes, error: caseCodesError } = await supabase
      .from('qr_codes')
      .select('id, master_code_id, status, variant_id, last_scanned_by')
      .eq('batch_id', masterCodeRecord.batch_id)
      .eq('case_number', caseNumber) // ✅ Link by case_number
      .eq('is_buffer', false)         // ✅ Exclude buffer codes
      .limit(100000) // Handle large cases
    
    // Detect if this is a mixed case
    const uniqueVariants = new Set(caseCodes?.map(c => c.variant_id).filter(Boolean) || [])
    const isMixedCase = uniqueVariants.size > 1
    
    console.log('📊 Found codes for case #' + caseNumber + ':', {
      total_found: caseCodes?.length || 0,
      expected: expectedUnits,
      match: caseCodes?.length === expectedUnits,
      is_mixed_case: isMixedCase,
      unique_products: uniqueVariants.size
    })

    if (caseCodesError) {
      console.error('❌ Failed to fetch case codes:', caseCodesError)
      throw caseCodesError
    }

    // Validation: Check if we found codes
    if (!caseCodes || caseCodes.length === 0) {
      return NextResponse.json(
        { 
          error: `No QR codes found for case #${caseNumber}. Case may not have been generated yet.`,
          case_number: caseNumber,
          found_count: 0
        },
        { status: 400 }
      )
    }

    // Validate unit count matches expected (strict validation)
    if (caseCodes.length !== expectedUnits) {
      const message = `Expected ${expectedUnits} codes but found ${caseCodes.length} for case #${caseNumber}. Case may be incomplete or over-filled.`
      console.error(`❌ ${message}${isMixedCase ? ' (mixed case)' : ''}`)
      
      return NextResponse.json(
        { 
          error: message,
          case_number: caseNumber,
          expected_count: expectedUnits,
          found_count: caseCodes.length,
          is_mixed_case: isMixedCase,
          unique_products: uniqueVariants.size
        },
        { status: 400 }
      )
    }

    // ============================================================================
    // PERFORMANCE: Single-pass processing - categorize all codes in one loop
    // ============================================================================
    const codesWithWorkerScans: any[] = []
    const alreadyLinkedToThisMaster: any[] = []
    const linkedToDifferentMaster: any[] = []
    const unlinkedCodes: any[] = []
    
    for (const qr of caseCodes) {
      // Check worker scans first (highest priority check)
      if (qr.last_scanned_by !== null) {
        codesWithWorkerScans.push(qr)
      }
      
      // Categorize by master_code_id
      if (qr.master_code_id === null) {
        unlinkedCodes.push(qr)
      } else if (qr.master_code_id === masterCodeRecord.id) {
        alreadyLinkedToThisMaster.push(qr)
      } else {
        linkedToDifferentMaster.push(qr)
      }
    }
    
    // CRITICAL: Check if this case has been worked on by workers
    if (codesWithWorkerScans.length > 0) {
      console.warn('⚠️ Case has worker scan history - cannot use Mark Perfect')
      
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
    const alreadyLinkedCount = alreadyLinkedToThisMaster.length + linkedToDifferentMaster.length
    if (alreadyLinkedCount > 0) {
      // If ALL codes are already linked to THIS master, treat as success
      const allLinkedToThisMaster = alreadyLinkedToThisMaster.length === caseCodes.length
      
      if (allLinkedToThisMaster && alreadyLinkedCount === caseCodes.length) {
        console.log('✅ All codes already linked to this master case')
        
        // IMPORTANT: Still need to update status to 'packed' even if already linked
        // This handles the case where codes were linked but status wasn't updated
        console.log('🔄 Updating status to packed for already-linked codes...')
        
        const { error: statusUpdateError } = await supabase
          .from('qr_codes')
          .update({
            status: 'packed',
            updated_at: new Date().toISOString()
          })
          .in('id', caseCodes.map(qr => qr.id))
          .neq('status', 'packed') // Only update if not already packed
        
        if (statusUpdateError) {
          console.error('❌ Failed to update code status:', statusUpdateError)
        } else {
          console.log('✅ Updated code status to packed')
        }
        
        // Update master code status to packed
        const { error: masterStatusError } = await supabase
          .from('qr_master_codes')
          .update({
            status: 'packed',
            actual_unit_count: caseCodes.length,
            updated_at: new Date().toISOString()
          })
          .eq('id', masterCodeRecord.id)
        
        if (masterStatusError) {
          console.error('❌ Failed to update master status:', masterStatusError)
        } else {
          console.log('✅ Updated master status to packed')
        }
        
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

      // Some codes linked to different masters (use pre-categorized array)
      if (linkedToDifferentMaster.length > 0) {
        // Codes are linked to different masters - this is an error
        // Fetch the master codes these codes are linked to
        const conflictingMasterIds = Array.from(new Set(linkedToDifferentMaster.map(qr => qr.master_code_id).filter((id): id is string => id !== null)))
        const { data: conflictingMasters } = await supabase
          .from('qr_master_codes')
          .select('id, master_code, case_number')
          .in('id', conflictingMasterIds)
          
          console.error('❌ Codes linked to different masters:', {
            trying_to_mark: { master_code: masterCodeRecord.master_code, case_number: caseNumber },
            conflicting_count: linkedToDifferentMaster.length
          })
          
          // Build detailed error message
          const mastersList = conflictingMasters?.map(m => 
            `Case #${m.case_number} (${m.master_code})`
          ).join(', ') || 'other cases'
          
          return NextResponse.json(
            { 
              error: `${linkedToDifferentMaster.length} code(s) already linked to different master cases. Cannot mark as perfect.`,
              message: `Cannot mark Case #${caseNumber} as perfect because ${linkedToDifferentMaster.length} codes in this range are already linked to ${mastersList}. This usually means the case was already processed or the units_per_case configuration changed after generation.`,
              already_linked_count: linkedToDifferentMaster.length,
              conflicting_masters: conflictingMasters?.map(m => ({
                master_code: m.master_code,
                case_number: m.case_number
              }))
            },
            { status: 400 }
          )
          }
      }

    // PERFORMANCE: Use pre-categorized unlinked codes array
    console.log('📊 Code status:', {
      total: caseCodes.length,
      already_linked_to_this_master: alreadyLinkedToThisMaster.length,
      available_to_link: unlinkedCodes.length,
      is_mixed_case: isMixedCase,
      unique_products: uniqueVariants.size
    })

    if (unlinkedCodes.length === 0) {
      console.log('✅ No new codes to link - case already complete')
      
      // IMPORTANT: Still update status to 'packed' for consistency
      console.log('🔄 Ensuring all codes have packed status...')
      
      const { error: statusUpdateError } = await supabase
        .from('qr_codes')
        .update({
          status: 'packed',
          updated_at: new Date().toISOString()
        })
        .in('id', caseCodes.map(qr => qr.id))
        .neq('status', 'packed')
      
      if (statusUpdateError) {
        console.error('❌ Failed to update code status:', statusUpdateError)
      }
      
      // Update master code status
      const { error: masterStatusError } = await supabase
        .from('qr_master_codes')
        .update({
          status: 'packed',
          actual_unit_count: caseCodes.length,
          updated_at: new Date().toISOString()
        })
        .eq('id', masterCodeRecord.id)
      
      if (masterStatusError) {
        console.error('❌ Failed to update master status:', masterStatusError)
      }
      
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

    // PERFORMANCE: Use pre-categorized unlinked codes
    const codeIdsToLink = unlinkedCodes.map(qr => qr.id)
    
    console.log('📝 Linking codes to master:', {
      codes_to_link: codeIdsToLink.length,
      master_code_id: masterCodeRecord.id,
      sample_code_ids: codeIdsToLink.slice(0, 3)
    })

    const updateStart = Date.now()
    const { data: updatedCodes, error: updateError } = await supabase
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
      .select('id, code, status, master_code_id')

    if (updateError) {
      console.error('❌ Failed to update QR codes:', updateError)
      throw updateError
    }

    console.log(`✅ Updated ${codeIdsToLink.length} codes in ${Date.now() - updateStart}ms`)

    // PERFORMANCE: Debug verification removed in production (saves 1 DB round-trip)
    // Uncomment for development debugging if needed:
    // if (process.env.NODE_ENV === 'development') {
    //   const { data: verifyUpdates } = await supabase
    //     .from('qr_codes')
    //     .select('id, status, master_code_id')
    //     .in('id', codeIdsToLink.slice(0, 3))
    //   console.log('Verification:', verifyUpdates?.length, 'codes checked')
    // }

    // Update master code to packed status
    // IMPORTANT: Set actual_unit_count to the TOTAL codes in this case (not add to existing)
    // This prevents double-counting when API is called multiple times
    const newActualCount = caseCodes.length
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
    const totalApiTime = Date.now() - startTime
    console.log(`⚡ Processing: ${totalProcessingTime}ms | Total API: ${totalApiTime}ms`)
    console.log('✨ CASE MARKED PERFECT - All codes automatically linked!')

    return NextResponse.json({
      success: true,
      message: `Case #${caseNumber} marked perfect! All ${caseCodes.length} codes linked automatically.`,
      linked_count: caseCodes.length,
      master_code_info: {
        id: masterCodeRecord.id,
        master_code: masterCodeRecord.master_code,
        case_number: masterCodeRecord.case_number,
        expected_units: masterCodeRecord.expected_unit_count,
        actual_units: newActualCount,
        linked_this_session: caseCodes.length,
        status: 'packed',
        warehouse_org_id: masterUpdates.warehouse_org_id || null
      },
      case_info: {
        case_number: caseNumber,
        is_mixed_case: isMixedCase,
        unique_products: uniqueVariants.size
      },
      performance: {
        processing_time_ms: totalProcessingTime,
        total_api_time_ms: totalApiTime,
        codes_per_second: Math.round((caseCodes.length / totalProcessingTime) * 1000)
      },
      order_info: orderInfo ? {
        order_id: masterOrderId,
        order_no: orderInfo.order_no,
        buyer_org_id: orderInfo.buyer_org_id
      } : undefined
    })

  } catch (error: any) {
    const totalTime = Date.now() - startTime
    console.error('❌ Error marking case perfect:', error, `(${totalTime}ms)`)
    return NextResponse.json(
      { error: error.message || 'Failed to mark case perfect' },
      { status: 500 }
    )
  }
}
