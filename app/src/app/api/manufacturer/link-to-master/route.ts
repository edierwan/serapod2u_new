import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { master_code, unique_codes, manufacturer_org_id, user_id, skip_case_validation } = body

    console.log('🔍 Link to master request:', { 
      master_code, 
      unique_codes_count: unique_codes?.length,
      manufacturer_org_id,
      skip_case_validation 
    })

    if (!master_code || !unique_codes || !Array.isArray(unique_codes) || unique_codes.length === 0) {
      return NextResponse.json(
        { error: 'Master code and unique codes array are required' },
        { status: 400 }
      )
    }

    // Extract master code from URL if needed
    let masterCodeToScan = master_code.trim()
    if (masterCodeToScan.includes('/track/')) {
      const parts = masterCodeToScan.split('/')
      masterCodeToScan = parts[parts.length - 1]
    }

    // Find master code in database
    const { data: masterCodeRecord, error: masterError } = await supabase
      .from('qr_master_codes')
      .select('*')
      .eq('master_code', masterCodeToScan)
      .single()

    if (masterError || !masterCodeRecord) {
      return NextResponse.json(
        { error: 'Master code not found in system' },
        { status: 404 }
      )
    }

    const { data: batchInfo, error: batchInfoError } = await supabase
      .from('qr_batches')
      .select(`
        id,
        order_id,
        orders (
          id,
          order_no,
          buyer_org_id,
          seller_org_id,
          company_id
        )
      `)
      .eq('id', masterCodeRecord.batch_id)
      .maybeSingle()

    if (batchInfoError) {
      console.error('❌ Failed to load batch/order for master code:', batchInfoError)
      throw batchInfoError
    }

    const orderRecord = batchInfo?.orders
      ? (Array.isArray(batchInfo.orders) ? batchInfo.orders[0] : batchInfo.orders)
      : null
    const targetWarehouseOrgId = orderRecord?.buyer_org_id || null

    const expectedUnits = Number(masterCodeRecord.expected_unit_count ?? 0)
    const currentActualCount = Number(masterCodeRecord.actual_unit_count ?? 0)
    const remainingCapacity = Math.max(expectedUnits - currentActualCount, 0)

    if (remainingCapacity <= 0 || masterCodeRecord.status === 'packed') {
      return NextResponse.json(
        { error: 'This master case is already full. Please link remaining codes to another case.' },
        { status: 400 }
      )
    }

    // PERFORMANCE OPTIMIZATION: Fetch all QR codes in single query with related data
    // Using .in() to batch fetch is more efficient than individual queries
    const perfStart = Date.now()
    const { data: qrCodeRecords, error: qrError } = await supabase
      .from('qr_codes')
      .select(`
        id, 
        code, 
        master_code_id, 
        batch_id, 
        order_id, 
        sequence_number,
        product_id,
        variant_id,
        product_variants (
          variant_name,
          variant_code
        )
      `)
      .in('code', unique_codes)

    console.log(`⚡ DB query completed in ${Date.now() - perfStart}ms`)

    if (qrError) {
      throw qrError
    }

    // IMPROVED LOGIC: Process valid codes and report issues separately
    // Instead of failing if not all codes are found, we'll process what we can
    // PERFORMANCE: Use Set for O(1) lookups instead of O(n) array operations
    
    const foundCodes = qrCodeRecords || []
    const foundCodesSet = new Set(foundCodes.map(qr => qr.code))
    const notFoundCodes = unique_codes.filter(code => !foundCodesSet.has(code))
    
    console.log('📊 QR Code breakdown:', {
      total_submitted: unique_codes.length,
      found_in_db: foundCodes.length,
      not_found: notFoundCodes.length
    })

    // Separate found codes into: already linked vs available
    const alreadyLinked = foundCodes.filter(qr => qr.master_code_id !== null)
    const availableCodes = foundCodes.filter(qr => qr.master_code_id === null)
    
    console.log('📊 Found codes breakdown:', {
      already_linked: alreadyLinked.length,
      available_to_link: availableCodes.length
    })

    // If no codes are available to link, provide detailed error
    if (availableCodes.length === 0) {
      const errorParts = []
      if (notFoundCodes.length > 0) {
        errorParts.push(`${notFoundCodes.length} code(s) not found in database`)
      }
      if (alreadyLinked.length > 0) {
        errorParts.push(`${alreadyLinked.length} code(s) already linked to master cases`)
      }
      
      return NextResponse.json(
        { 
          error: `No valid codes available to link. ${errorParts.join(', ')}.`,
          not_found_count: notFoundCodes.length,
          already_linked_count: alreadyLinked.length,
          total_submitted: unique_codes.length
        },
        { status: 400 }
      )
    }

    // Use available codes for processing (preserve original order)
    const orderedRecords = unique_codes
      .map(code => availableCodes.find(qr => qr.code === code))
      .filter((record): record is typeof foundCodes[number] => Boolean(record))

    // SMART VARIANT FILTERING: Auto-filter codes by variant instead of blocking
    // This applies to both regular codes AND buffer codes
    // If master case already has codes, determine its variant
    // Otherwise, use the most common variant from scanned codes
    
    let targetVariantId: string | null = null
    let targetVariantName = 'Unknown'
    
    // Check if master case already has codes with a specific variant
    if (currentActualCount > 0) {
      const { data: existingCodes } = await supabase
        .from('qr_codes')
        .select('variant_id, product_variants(variant_name, variant_code)')
        .eq('master_code_id', masterCodeRecord.id)
        .limit(1)
        .single()

      if (existingCodes && existingCodes.variant_id) {
        targetVariantId = existingCodes.variant_id
        const variant = Array.isArray(existingCodes.product_variants) 
          ? existingCodes.product_variants[0] 
          : existingCodes.product_variants
        targetVariantName = variant?.variant_name || 'Unknown'
      }
    } else {
      // No existing codes - use the most common variant from scanned codes
      const variantCounts = orderedRecords.reduce((acc, qr) => {
        const variantId = qr.variant_id || 'unknown'
        acc[variantId] = (acc[variantId] || 0) + 1
        return acc
      }, {} as Record<string, number>)
      
      // Get the most common variant
      const mostCommonVariantId = Object.entries(variantCounts)
        .sort(([, a], [, b]) => b - a)[0]?.[0]
      
      if (mostCommonVariantId && mostCommonVariantId !== 'unknown') {
        targetVariantId = mostCommonVariantId
        const firstMatchingRecord = orderedRecords.find(qr => qr.variant_id === targetVariantId)
        if (firstMatchingRecord) {
          const variant = Array.isArray(firstMatchingRecord.product_variants) 
            ? firstMatchingRecord.product_variants[0] 
            : firstMatchingRecord.product_variants
          targetVariantName = variant?.variant_name || 'Unknown'
        }
      }
    }
    
    // Filter codes to only include matching variant
    const matchingVariantCodes = targetVariantId 
      ? orderedRecords.filter(qr => qr.variant_id === targetVariantId)
      : orderedRecords
    
    const skippedVariantCodes = targetVariantId
      ? orderedRecords.filter(qr => qr.variant_id !== targetVariantId)
      : []
    
    // Build variant summary for skipped codes
    const skippedVariantSummary: Record<string, number> = {}
    skippedVariantCodes.forEach(qr => {
      const variant = Array.isArray(qr.product_variants) 
        ? qr.product_variants[0] 
        : qr.product_variants
      const variantName = variant?.variant_name || 'Unknown Variant'
      skippedVariantSummary[variantName] = (skippedVariantSummary[variantName] || 0) + 1
    })

    // SMART BATCH FILTERING: Instead of failing, filter codes by batch
    // Separate codes into: matching batch vs wrong batch
    const correctBatchCodes = orderedRecords.filter(qr => qr.batch_id === masterCodeRecord.batch_id)
    const wrongBatchCodes = orderedRecords.filter(qr => qr.batch_id !== masterCodeRecord.batch_id)
    
    // Build summary of wrong batch codes with their batch IDs
    const wrongBatchSummary: Record<string, number> = {}
    wrongBatchCodes.forEach(qr => {
      const batchId = qr.batch_id || 'unknown'
      wrongBatchSummary[batchId] = (wrongBatchSummary[batchId] || 0) + 1
    })
    
    console.log('📊 Batch filtering:', {
      master_batch_id: masterCodeRecord.batch_id,
      correct_batch: correctBatchCodes.length,
      wrong_batch: wrongBatchCodes.length,
      wrong_batch_summary: wrongBatchSummary
    })

    // If no codes match the correct batch, provide detailed error
    if (correctBatchCodes.length === 0 && wrongBatchCodes.length > 0) {
      const batchList = Object.entries(wrongBatchSummary)
        .map(([batchId, count]) => `${count} codes from batch ${batchId}`)
        .join(', ')
      
      return NextResponse.json(
        { 
          error: `No codes match this master case batch (${masterCodeRecord.batch_id}). Found: ${batchList}`,
          wrong_batch_count: wrongBatchCodes.length,
          expected_batch_id: masterCodeRecord.batch_id
        },
        { status: 400 }
      )
    }

    // Continue processing with codes from the correct batch only
    const batchFilteredRecords = correctBatchCodes

    // SMART VARIANT FILTERING on batch-filtered codes
    // Re-apply variant filtering to the batch-filtered records
    const variantFilteredRecords = targetVariantId 
      ? batchFilteredRecords.filter(qr => qr.variant_id === targetVariantId)
      : batchFilteredRecords
    
    const wrongVariantCodes = targetVariantId
      ? batchFilteredRecords.filter(qr => qr.variant_id !== targetVariantId)
      : []

    console.log('📊 Variant filtering on batch-matched codes:', {
      batch_matched: batchFilteredRecords.length,
      variant_matched: variantFilteredRecords.length,
      variant_mismatched: wrongVariantCodes.length,
      target_variant: targetVariantName
    })

    // CONDITIONAL: Validate case number matching by sequence number range
    // Only validate if skip_case_validation is not true
    let wrongSequenceCodes: typeof variantFilteredRecords = []
    if (!skip_case_validation) {
      const expectedUnitsPerCase = masterCodeRecord.expected_unit_count
      const caseNumber = masterCodeRecord.case_number
      const minSequence = ((caseNumber - 1) * expectedUnitsPerCase) + 1
      const maxSequence = caseNumber * expectedUnitsPerCase

      // Filter codes by sequence range instead of failing
      const correctSequenceCodes = variantFilteredRecords.filter(qr => 
        qr.sequence_number >= minSequence && qr.sequence_number <= maxSequence
      )
      
      wrongSequenceCodes = variantFilteredRecords.filter(qr => 
        qr.sequence_number < minSequence || qr.sequence_number > maxSequence
      )

      console.log('📊 Sequence validation:', {
        case_number: caseNumber,
        expected_range: `${minSequence}-${maxSequence}`,
        correct_sequence: correctSequenceCodes.length,
        wrong_sequence: wrongSequenceCodes.length
      })

      // If no codes have correct sequence, provide error
      if (correctSequenceCodes.length === 0 && wrongSequenceCodes.length > 0) {
        const wrongSequences = wrongSequenceCodes.map(qr => qr.sequence_number).join(', ')
        return NextResponse.json(
          { 
            error: `No codes match Case #${caseNumber} sequence range (${minSequence}-${maxSequence}). Found sequences: ${wrongSequences}`,
            wrong_sequence_count: wrongSequenceCodes.length,
            expected_range: `${minSequence}-${maxSequence}`
          },
          { status: 400 }
        )
      }
      
      // Use sequence-validated codes
      const codesToProcess = correctSequenceCodes
      console.log('✅ Case validation passed: ' + codesToProcess.length + ' codes belong to Case #' + caseNumber)
    } else {
      console.log('⚠️ Case validation SKIPPED by user choice')
    }

    // Use the fully filtered codes for linking
    const codesToProcess = !skip_case_validation 
      ? variantFilteredRecords.filter(qr => {
          const expectedUnitsPerCase = masterCodeRecord.expected_unit_count
          const caseNumber = masterCodeRecord.case_number
          const minSequence = ((caseNumber - 1) * expectedUnitsPerCase) + 1
          const maxSequence = caseNumber * expectedUnitsPerCase
          return qr.sequence_number >= minSequence && qr.sequence_number <= maxSequence
        })
      : variantFilteredRecords

    const recordsToLink = codesToProcess.slice(0, remainingCapacity)
    const codesToLink = recordsToLink.map(record => record.code)
    const unusedCodes = codesToProcess.slice(recordsToLink.length).map(record => record.code)

    if (codesToLink.length === 0) {
      // Build comprehensive error message about all filtering stages
      const errorParts = []
      
      if (notFoundCodes.length > 0) {
        errorParts.push(`${notFoundCodes.length} not found in database`)
      }
      if (alreadyLinked.length > 0) {
        errorParts.push(`${alreadyLinked.length} already linked`)
      }
      if (wrongBatchCodes.length > 0) {
        errorParts.push(`${wrongBatchCodes.length} from different batch`)
      }
      if (wrongVariantCodes.length > 0) {
        errorParts.push(`${wrongVariantCodes.length} wrong variant`)
      }
      if (wrongSequenceCodes.length > 0) {
        errorParts.push(`${wrongSequenceCodes.length} wrong case sequence`)
      }
      if (remainingCapacity === 0) {
        errorParts.push('master case is full')
      }
      
      return NextResponse.json(
        { 
          error: `No valid codes available to link. Issues: ${errorParts.join(', ')}.`,
          filtering_summary: {
            total_submitted: unique_codes.length,
            not_found: notFoundCodes.length,
            already_linked: alreadyLinked.length,
            wrong_batch: wrongBatchCodes.length,
            wrong_variant: wrongVariantCodes.length,
            wrong_sequence: wrongSequenceCodes.length,
            remaining_capacity: remainingCapacity
          }
        },
        { status: 400 }
      )
    }

    // PERFORMANCE: Batch update QR codes in single query using .in() operator
    console.log('📝 Updating QR codes:', {
      requested_count: unique_codes.length,
      linked_count: codesToLink.length,
      master_code_id: masterCodeRecord.id,
      manufacturer_org_id
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
      .in('code', codesToLink)

    if (updateError) {
      console.error('❌ Failed to update QR codes:', updateError)
      throw updateError
    }

    console.log(`✅ QR codes updated successfully in ${Date.now() - updateStart}ms`)

    // Update master code
    const masterIsNowComplete = currentActualCount + codesToLink.length >= masterCodeRecord.expected_unit_count
    const masterUpdates: Record<string, any> = {
      actual_unit_count: currentActualCount + codesToLink.length,
      status: masterIsNowComplete ? 'packed' : 'generated',
      manufacturer_scanned_at: new Date().toISOString(),
      manufacturer_scanned_by: user_id || null,
      manufacturer_org_id: manufacturer_org_id || null,
      updated_at: new Date().toISOString()
    }

    if (masterIsNowComplete && targetWarehouseOrgId) {
      masterUpdates.warehouse_org_id = targetWarehouseOrgId
    }

    console.log('📝 Updating master code:', {
      id: masterCodeRecord.id,
      previous_actual_count: currentActualCount,
      linked_this_session: codesToLink.length,
      new_actual_count: masterUpdates.actual_unit_count,
      expected_unit_count: masterCodeRecord.expected_unit_count,
      status: masterUpdates.status,
      manufacturer_org_id,
      assigned_warehouse_org_id: masterUpdates.warehouse_org_id || masterCodeRecord.warehouse_org_id || null
    })

    const { error: masterUpdateError } = await supabase
      .from('qr_master_codes')
      .update(masterUpdates)
      .eq('id', masterCodeRecord.id)

    if (masterUpdateError) {
      console.error('❌ Failed to update master code:', masterUpdateError)
      throw masterUpdateError
    }

    console.log('✅ Master code updated successfully')
    console.log('✅ LINKING COMPLETE - Master should now appear in scan history with:', {
      status: masterUpdates.status,
      manufacturer_org_id,
      warehouse_org_id: masterUpdates.warehouse_org_id || masterCodeRecord.warehouse_org_id || null,
      case_number: masterCodeRecord.case_number,
      actual_unit_count: masterUpdates.actual_unit_count,
      expected_unit_count: masterCodeRecord.expected_unit_count,
      unused_codes_count: unusedCodes.length,
      skipped_variant_count: skippedVariantCodes.length
    })

    // Update batch status to 'in_production' when first master case is linked
    // Only update if batch status is currently 'printing' or 'generated'
    if (masterCodeRecord.batch_id) {
      const { data: batchData } = await supabase
        .from('qr_batches')
        .select('status')
        .eq('id', masterCodeRecord.batch_id)
        .single()

      if (batchData && (batchData.status === 'printing' || batchData.status === 'generated')) {
        const { error: batchUpdateError } = await supabase
          .from('qr_batches')
          .update({ 
            status: 'in_production',
            updated_at: new Date().toISOString()
          })
          .eq('id', masterCodeRecord.batch_id)

        if (batchUpdateError) {
          console.error('❌ Failed to update batch status to in_production:', batchUpdateError)
        } else {
          console.log('✅ Batch status updated to "in_production"')
        }
      }
    }

    // PERFORMANCE: Log total processing time
    const totalProcessingTime = Date.now() - perfStart
    console.log(`⚡ Total processing time: ${totalProcessingTime}ms for ${codesToLink.length} codes`)

    // Build response with variant filtering information
    const response: any = {
      success: true,
      linked_count: codesToLink.length,
      remaining_capacity: Math.max(expectedUnits - (currentActualCount + codesToLink.length), 0),
      master_code_info: {
        id: masterCodeRecord.id,
        master_code: masterCodeRecord.master_code,
        case_number: masterCodeRecord.case_number,
        expected_units: masterCodeRecord.expected_unit_count,
        actual_units: masterUpdates.actual_unit_count,
        linked_this_session: codesToLink.length,
        is_complete: masterIsNowComplete,
        variant_name: targetVariantName,
        warehouse_org_id: masterUpdates.warehouse_org_id || masterCodeRecord.warehouse_org_id || null
      },
      linked_codes: codesToLink,
      unused_codes: unusedCodes,
      performance: {
        processing_time_ms: totalProcessingTime,
        codes_per_second: Math.round((codesToLink.length / totalProcessingTime) * 1000)
      }
    }

    // Add variant filtering information if codes were skipped
    if (skippedVariantCodes.length > 0) {
      response.skipped_variant_codes = skippedVariantCodes.map(qr => qr.code)
      response.skipped_variant_count = skippedVariantCodes.length
      response.skipped_variant_summary = skippedVariantSummary
      response.variant_filter_applied = true
      response.target_variant = targetVariantName
    }

    // Add comprehensive filtering information about all codes
    const hasFilteredCodes = notFoundCodes.length > 0 || alreadyLinked.length > 0 || 
                            wrongBatchCodes.length > 0 || wrongVariantCodes.length > 0 || 
                            wrongSequenceCodes.length > 0

    if (hasFilteredCodes) {
      response.filtering_summary = {
        total_submitted: unique_codes.length,
        successfully_linked: codesToLink.length,
        not_found: notFoundCodes.length,
        already_linked: alreadyLinked.length,
        wrong_batch: wrongBatchCodes.length,
        wrong_variant: wrongVariantCodes.length,
        wrong_sequence: wrongSequenceCodes.length,
        unused_capacity: unusedCodes.length
      }
      
      // Build detailed user-friendly message
      const issueParts = []
      if (notFoundCodes.length > 0) {
        issueParts.push(`${notFoundCodes.length} not found`)
      }
      if (alreadyLinked.length > 0) {
        issueParts.push(`${alreadyLinked.length} already linked`)
      }
      if (wrongBatchCodes.length > 0) {
        const batchList = Object.keys(wrongBatchSummary).join(', ')
        issueParts.push(`${wrongBatchCodes.length} from wrong batch (${batchList})`)
      }
      if (wrongVariantCodes.length > 0) {
        issueParts.push(`${wrongVariantCodes.length} wrong variant`)
      }
      if (wrongSequenceCodes.length > 0) {
        issueParts.push(`${wrongSequenceCodes.length} wrong case sequence`)
      }
      
      if (issueParts.length > 0) {
        response.processing_note = `✅ Successfully linked ${codesToLink.length} of ${unique_codes.length} codes. Filtered out: ${issueParts.join(', ')}.`
      }
      
      // Add details for debugging/transparency
      response.filtered_codes_detail = {
        not_found_codes: notFoundCodes.length > 10 ? `${notFoundCodes.length} codes` : notFoundCodes,
        already_linked_count: alreadyLinked.length,
        wrong_batch_summary: wrongBatchSummary,
        wrong_variant_count: wrongVariantCodes.length,
        wrong_sequence_count: wrongSequenceCodes.length
      }
    }

    if (orderRecord) {
      response.order_info = {
        order_id: orderRecord.id,
        order_no: orderRecord.order_no,
        buyer_org_id: orderRecord.buyer_org_id,
        seller_org_id: orderRecord.seller_org_id,
        warehouse_org_id: targetWarehouseOrgId,
        company_id: orderRecord.company_id || null
      }
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('Error linking to master:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to link codes to master case' },
      { status: 500 }
    )
  }
}
