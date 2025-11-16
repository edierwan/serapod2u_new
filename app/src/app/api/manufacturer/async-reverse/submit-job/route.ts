import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Helper to extract sequence number from various input formats
function extractSequenceNumber(input: string): number | null {
  const trimmed = input.trim()
  
  // If it's just a number, return it
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10)
  }
  
  // If it's a full tracking URL
  if (trimmed.includes('serapod2u.com/track/product/')) {
    const match = trimmed.match(/-(\d{5})(?:-[a-f0-9]+)?$/i)
    if (match) return parseInt(match[1], 10)
  }
  
  // If it's a raw QR code format: PROD-...-ORD-...-02-00015
  const rawMatch = trimmed.match(/-(\d{2})-(\d{5})$/i)
  if (rawMatch) return parseInt(rawMatch[2], 10)
  
  return null
}

// Helper to extract variant key from QR code
function extractVariantKey(qrCode: string): string | null {
  // Format: PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015
  // Variant key: PROD-CELVA9464-CRA-843412
  const match = qrCode.match(/^(PROD-[^-]+-[^-]+-[^-]+)-ORD-/)
  return match ? match[1] : null
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    const supabase = await createClient()
    const body = await request.json()
    
    const { batch_id, order_id, spoiled_inputs, created_by } = body
    
    if (!batch_id || !order_id || !spoiled_inputs || !Array.isArray(spoiled_inputs)) {
      return NextResponse.json(
        { error: 'Missing required fields: batch_id, order_id, spoiled_inputs' },
        { status: 400 }
      )
    }
    
    if (spoiled_inputs.length === 0) {
      return NextResponse.json(
        { error: 'No spoiled codes provided' },
        { status: 400 }
      )
    }
    
    console.log('📥 Async Reverse Job - Submit:', {
      batch_id,
      order_id,
      spoiled_count: spoiled_inputs.length,
      created_by
    })
    
    // Step 1: Parse inputs and extract sequence numbers
    const sequences: number[] = []
    for (const input of spoiled_inputs) {
      const seq = extractSequenceNumber(input)
      if (seq !== null) {
        sequences.push(seq)
      } else {
        console.warn(`⚠️ Could not parse sequence from: ${input}`)
      }
    }
    
    if (sequences.length === 0) {
      return NextResponse.json(
        { error: 'Could not extract any valid sequence numbers from inputs' },
        { status: 400 }
      )
    }
    
    console.log('✅ Extracted sequences:', sequences)
    
    // Step 2: Find the first valid QR code to get variant_key and case_number
    const { data: firstCode, error: codeError } = await supabase
      .from('qr_codes')
      .select('id, code, variant_key, case_number, batch_id')
      .eq('batch_id', batch_id)
      .eq('sequence_number', sequences[0])
      .single()
    
    if (codeError || !firstCode) {
      console.error('❌ Could not find QR code for sequence:', sequences[0], codeError)
      return NextResponse.json(
        { error: `QR code not found for sequence ${sequences[0]}. Please ensure it belongs to the selected batch.` },
        { status: 404 }
      )
    }
    
    const variant_key = firstCode.variant_key || extractVariantKey(firstCode.code)
    const case_number = firstCode.case_number
    
    if (!case_number) {
      return NextResponse.json(
        { error: 'QR code is missing case_number. Please run the Mode C migration first.' },
        { status: 500 }
      )
    }
    
    console.log('📦 Case Info:', { variant_key, case_number })
    
    // Step 3: Validate all sequences are from the same case
    const { data: allCodes, error: validateError } = await supabase
      .from('qr_codes')
      .select('id, sequence_number, case_number, status')
      .eq('batch_id', batch_id)
      .in('sequence_number', sequences)
    
    if (validateError) {
      console.error('❌ Error validating sequences:', validateError)
      return NextResponse.json(
        { error: 'Failed to validate sequence numbers' },
        { status: 500 }
      )
    }
    
    // Check if all are from same case
    const differentCase = allCodes?.find(c => c.case_number !== case_number)
    if (differentCase) {
      return NextResponse.json(
        { error: `All spoiled codes must be from the same case. Found sequence ${differentCase.sequence_number} from case ${differentCase.case_number}, but expected case ${case_number}.` },
        { status: 400 }
      )
    }
    
    // Check if any codes are already marked as spoiled or in a reverse job
    const alreadyProcessed = allCodes?.filter(c => c.status === 'spoiled')
    if (alreadyProcessed && alreadyProcessed.length > 0) {
      const seqs = alreadyProcessed.map(c => c.sequence_number).join(', ')
      return NextResponse.json(
        { error: `Some codes are already marked as spoiled: ${seqs}. They may already be in a reverse job.` },
        { status: 400 }
      )
    }
    
    console.log('✅ All sequences validated for case:', case_number)
    
    // Step 3.5: Get manufacturer_org_id from order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('seller_org_id')
      .eq('id', order_id)
      .single()
    
    if (orderError || !order || !order.seller_org_id) {
      console.error('❌ Failed to fetch order:', orderError)
      return NextResponse.json(
        { error: 'Failed to fetch order information' },
        { status: 500 }
      )
    }
    
    // Step 4: Create qr_reverse_jobs record
    const { data: job, error: jobError } = await supabase
      .from('qr_reverse_jobs')
      .insert({
        batch_id,
        order_id,
        manufacturer_org_id: order.seller_org_id,
        case_number,
        variant_key,
        total_spoiled: sequences.length,
        status: 'queued',
        created_by: created_by || null,
        created_at: new Date().toISOString()
      })
      .select()
      .single()
    
    if (jobError || !job) {
      console.error('❌ Failed to create job:', jobError)
      return NextResponse.json(
        { error: 'Failed to create reverse job' },
        { status: 500 }
      )
    }
    
    console.log('✅ Created job:', job.id)
    
    // Step 5: Create qr_reverse_job_items for each spoiled code
    const items = allCodes.map(code => ({
      job_id: job.id,
      spoiled_code_id: code.id,
      spoiled_sequence_no: code.sequence_number,
      created_at: new Date().toISOString()
    }))
    
    const { error: itemsError } = await supabase
      .from('qr_reverse_job_items')
      .insert(items)
    
    if (itemsError) {
      console.error('❌ Failed to create job items:', itemsError)
      // Rollback job
      await supabase.from('qr_reverse_jobs').delete().eq('id', job.id)
      return NextResponse.json(
        { error: 'Failed to create job items' },
        { status: 500 }
      )
    }
    
    console.log(`✅ Created ${items.length} job items`)
    
    const duration = Date.now() - startTime
    console.log(`✅ Job submitted successfully in ${duration}ms`)
    
    return NextResponse.json({
      success: true,
      job_id: job.id,
      case_number,
      total_spoiled: sequences.length,
      product_variant_key: variant_key,
      message: `Job created for Case #${case_number} with ${sequences.length} spoiled code(s). Processing will begin shortly.`,
      duration_ms: duration
    })
    
  } catch (error: any) {
    console.error('❌ Submit job error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
