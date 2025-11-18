import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * BULK Mark All Master Cases Perfect
 * 
 * Ultra-fast mode: Mark ALL master cases in an order as packed in one operation
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now()
  try {
    const supabase = await createClient()
    const body = await request.json()
    const { order_id, manufacturer_org_id } = body

    console.log('🚀 BULK Mark All Perfect request:', { 
      order_id,
      manufacturer_org_id
    })

    if (!order_id) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      )
    }

    // Get all batches for this order
    const { data: batches, error: batchError } = await supabase
      .from('qr_batches')
      .select('id')
      .eq('order_id', order_id)

    if (batchError || !batches || batches.length === 0) {
      console.error('❌ No batches found:', batchError)
      return NextResponse.json(
        { error: 'No batches found for this order' },
        { status: 404 }
      )
    }

    const batchIds = batches.map(b => b.id)
    console.log(`📦 Found ${batchIds.length} batches for order`)

    // Get all master codes for these batches
    const { data: masterCodes, error: masterError } = await supabase
      .from('qr_master_codes')
      .select('id, batch_id, case_number')
      .in('batch_id', batchIds)

    if (masterError || !masterCodes || masterCodes.length === 0) {
      console.error('❌ No master codes found:', masterError)
      return NextResponse.json(
        { error: 'No master codes found for this order' },
        { status: 404 }
      )
    }

    console.log(`📊 Found ${masterCodes.length} master codes to mark`)

    // ============================================================================
    // CORRECT STRATEGY: Link by (batch_id, case_number) - supports mixed cases
    // ============================================================================
    // NEVER distribute codes evenly by index!
    // A case can contain multiple products/variants with the same case_number.
    // We link ALL non-buffer codes in a case to its corresponding master code.
    // ============================================================================
    
    let totalCodesLinked = 0
    let totalMastersProcessed = 0
    const inconsistentCases: Array<{case_number: number, expected: number, actual: number}> = []
    
    for (const batch of batches) {
      const masterCodesInBatch = masterCodes.filter(m => m.batch_id === batch.id)
      
      if (masterCodesInBatch.length === 0) {
        console.warn(`⚠️ No master codes for batch ${batch.id}`)
        continue
      }
      
      console.log(`📦 Processing batch ${batch.id}: ${masterCodesInBatch.length} master cases`)
      
      // Get master codes with expected_unit_count for validation
      const { data: masterDetails, error: masterDetailsError } = await supabase
        .from('qr_master_codes')
        .select('id, case_number, expected_unit_count')
        .eq('batch_id', batch.id)
      
      if (masterDetailsError || !masterDetails) {
        console.error(`❌ Failed to fetch master details for batch ${batch.id}:`, masterDetailsError)
        continue
      }
      
      // Create a map of master_id -> expected_unit_count
      const masterExpectedMap = new Map(masterDetails.map(m => [m.id, m.expected_unit_count]))
      
      // Process each master case individually
      for (const master of masterCodesInBatch) {
        const expectedUnits = masterExpectedMap.get(master.id) || 0
        
        // CRITICAL: Link by case_number, not by index slicing!
        // Get ALL non-buffer codes for this specific case_number in this batch
        const { data: caseCodes, error: caseCodesError } = await supabase
          .from('qr_codes')
          .select('id, case_number, variant_id, is_buffer')
          .eq('batch_id', batch.id)
          .eq('case_number', master.case_number)
          .eq('is_buffer', false) // Only real case codes, not buffer pool
          .limit(100000) // Handle large cases
        
        if (caseCodesError) {
          console.error(`❌ Failed to fetch codes for case #${master.case_number}:`, caseCodesError)
          continue
        }
        
        if (!caseCodes || caseCodes.length === 0) {
          console.warn(`⚠️ No codes found for case #${master.case_number}`)
          continue
        }
        
        // Check if this is a mixed case (multiple variants in one case)
        const uniqueVariants = new Set(caseCodes.map(c => c.variant_id).filter(Boolean))
        const isMixedCase = uniqueVariants.size > 1
        
        console.log(`📋 Case #${master.case_number}: ${caseCodes.length} units` + 
          (isMixedCase ? ` (MIXED: ${uniqueVariants.size} products)` : ''))
        
        // Validate unit count
        if (caseCodes.length !== expectedUnits) {
          inconsistentCases.push({
            case_number: master.case_number,
            expected: expectedUnits,
            actual: caseCodes.length
          })
          console.warn(`⚠️ Case #${master.case_number}: Expected ${expectedUnits} units, found ${caseCodes.length}`)
        }
        
        // Link all these codes to this master
        const codeIds = caseCodes.map(c => c.id)
        const { error: linkError } = await supabase
          .from('qr_codes')
          .update({
            master_code_id: master.id,
            status: 'packed',
            updated_at: new Date().toISOString()
          })
          .in('id', codeIds)
        
        if (linkError) {
          console.error(`❌ Failed to link codes to master case #${master.case_number}:`, linkError)
          continue
        }
        
        // Update master code with actual count
        const { error: masterUpdateError } = await supabase
          .from('qr_master_codes')
          .update({
            status: 'packed',
            actual_unit_count: caseCodes.length,
            updated_at: new Date().toISOString()
          })
          .eq('id', master.id)
        
        if (masterUpdateError) {
          console.error(`❌ Failed to update master case #${master.case_number}:`, masterUpdateError)
          continue
        }
        
        totalCodesLinked += caseCodes.length
        totalMastersProcessed++
        console.log(`✅ Case #${master.case_number}: Linked ${caseCodes.length} codes${isMixedCase ? ' (mixed)' : ''}`)
      }
    }

    const totalTime = Date.now() - startTime
    console.log(`✅ BULK SUCCESS: Marked ${totalMastersProcessed} master codes, linked ${totalCodesLinked} unit codes in ${totalTime}ms`)
    
    if (inconsistentCases.length > 0) {
      console.warn(`⚠️ WARNING: ${inconsistentCases.length} cases have mismatched unit counts:`, inconsistentCases)
    }

    return NextResponse.json({
      success: true,
      message: `Bulk marked ${totalMastersProcessed} master cases as packed`,
      master_codes_marked: totalMastersProcessed,
      unit_codes_linked: totalCodesLinked,
      batches_processed: batchIds.length,
      inconsistent_cases: inconsistentCases.length > 0 ? inconsistentCases : undefined,
      total_time_ms: totalTime
    })

  } catch (error: any) {
    console.error('❌ Bulk mark all perfect error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to bulk mark all cases' },
      { status: 500 }
    )
  }
}
