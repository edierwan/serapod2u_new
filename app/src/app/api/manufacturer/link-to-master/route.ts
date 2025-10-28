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

    // Get all QR code records with sequence numbers AND variant information
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

    if (qrError) {
      throw qrError
    }

    if (!qrCodeRecords || qrCodeRecords.length !== unique_codes.length) {
      return NextResponse.json(
        { 
          error: `Some QR codes not found. Expected ${unique_codes.length}, found ${qrCodeRecords?.length || 0}` 
        },
        { status: 400 }
      )
    }

    // Preserve original order from user submission
    const orderedRecords = unique_codes
      .map(code => qrCodeRecords.find(qr => qr.code === code))
      .filter((record): record is typeof qrCodeRecords[number] => Boolean(record))

    if (orderedRecords.length !== unique_codes.length) {
      return NextResponse.json(
        { error: 'Some QR codes were not found for this batch. Please double-check the pasted list.' },
        { status: 400 }
      )
    }

    // Check if any codes are already linked
    const alreadyLinked = orderedRecords.filter(qr => qr.master_code_id !== null)
    if (alreadyLinked.length > 0) {
      return NextResponse.json(
        { 
          error: `${alreadyLinked.length} code(s) are already linked to another master case` 
        },
        { status: 400 }
      )
    }

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

    // Check if all codes belong to same batch and order
    const batchIds = Array.from(new Set(qrCodeRecords.map(qr => qr.batch_id)))
    const orderIds = Array.from(new Set(qrCodeRecords.map(qr => qr.order_id)))
    
    if (batchIds.length > 1) {
      return NextResponse.json(
        { error: 'All QR codes must belong to the same batch' },
        { status: 400 }
      )
    }

    if (batchIds[0] !== masterCodeRecord.batch_id) {
      return NextResponse.json(
        { error: 'QR codes do not match the master case batch' },
        { status: 400 }
      )
    }

    // CONDITIONAL: Validate case number matching by sequence number range
    // Only validate if skip_case_validation is not true
    if (!skip_case_validation) {
      const expectedUnitsPerCase = masterCodeRecord.expected_unit_count
      const caseNumber = masterCodeRecord.case_number
      const minSequence = ((caseNumber - 1) * expectedUnitsPerCase) + 1
      const maxSequence = caseNumber * expectedUnitsPerCase

      // Check if all QR codes fall within the expected sequence range for this case
      const invalidSequences = qrCodeRecords.filter(qr => 
        qr.sequence_number < minSequence || qr.sequence_number > maxSequence
      )

      if (invalidSequences.length > 0) {
        const wrongSequences = invalidSequences.map(qr => qr.sequence_number).join(', ')
        return NextResponse.json(
          { 
            error: `QR codes do not belong to Case #${caseNumber}. Expected sequence ${minSequence}-${maxSequence}, but found codes with sequences: ${wrongSequences}. Please scan codes from the correct case. (You can disable this check using the "Skip Case Validation" option if needed)` 
          },
          { status: 400 }
        )
      }
      
      console.log('✅ Case validation passed: All codes belong to Case #' + caseNumber)
    } else {
      console.log('⚠️ Case validation SKIPPED by user choice')
    }

    // Use matching variant codes for linking
    const codesToProcess = matchingVariantCodes

    const recordsToLink = codesToProcess.slice(0, remainingCapacity)
    const codesToLink = recordsToLink.map(record => record.code)
    const unusedCodes = codesToProcess.slice(recordsToLink.length).map(record => record.code)

    if (codesToLink.length === 0) {
      // No codes matched the variant - provide helpful message
      if (skippedVariantCodes.length > 0) {
        const skippedList = Object.entries(skippedVariantSummary)
          .map(([name, count]) => `${name} (${count} codes)`)
          .join(', ')
        
        return NextResponse.json(
          { 
            error: `This master case accepts "${targetVariantName}" variant only. All ${unique_codes.length} scanned codes belong to different variants: ${skippedList}. Please scan codes with the correct variant.` 
          },
          { status: 400 }
        )
      }
      
      return NextResponse.json(
        { error: 'No remaining capacity on this master case. Link these codes to a different case.' },
        { status: 400 }
      )
    }

    // Update QR codes to link to master
    console.log('📝 Updating QR codes:', {
      requested_count: unique_codes.length,
      linked_count: codesToLink.length,
      master_code_id: masterCodeRecord.id,
      manufacturer_org_id
    })
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

    console.log('✅ QR codes updated successfully')

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
      unused_codes: unusedCodes
    }

    // Add variant filtering information if codes were skipped
    if (skippedVariantCodes.length > 0) {
      response.skipped_variant_codes = skippedVariantCodes.map(qr => qr.code)
      response.skipped_variant_count = skippedVariantCodes.length
      response.skipped_variant_summary = skippedVariantSummary
      response.variant_filter_applied = true
      response.target_variant = targetVariantName
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
