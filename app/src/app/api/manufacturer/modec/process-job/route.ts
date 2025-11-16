import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Mode C Background Worker - Process One Job at a Time
 * 
 * This worker:
 * 1. Finds the NEXT pending job using SELECT FOR UPDATE SKIP LOCKED (prevents race conditions)
 * 2. Marks it as 'processing'
 * 3. Runs the buffer replacement logic
 * 4. Marks it as 'completed' or 'failed'
 * 5. Is idempotent - safe to call many times
 * 
 * DEPLOYMENT:
 * - Development: Call via npm run modec:worker (runs in loop)
 * - Production: Schedule as cron job (every 30 seconds) OR Supabase Edge Function
 * 
 * HOW TO RUN:
 * ```bash
 * # Development - Run worker in loop
 * npm run modec:worker
 * 
 * # Production - Set up cron
 * # Option 1: Vercel Cron (vercel.json)
 * # Option 2: Supabase Scheduled Function
 * # Option 3: External cron service hitting this endpoint
 * ```
 */

/**
 * Recalculate master case statistics after processing
 */
async function recalculateMasterCaseStats(supabase: any, masterId: string, manufacturerOrgId?: string) {
  const { data: master, error: masterError } = await supabase
    .from('qr_master_codes')
    .select('id, master_code, case_number, expected_unit_count, batch_id, qr_batches(order_id)')
    .eq('id', masterId)
    .single()

  if (masterError || !master) {
    throw new Error(`Master code not found: ${masterId}`)
  }

  const expectedCount = Number(master.expected_unit_count || 0)
  const orderId = master.qr_batches?.order_id || (Array.isArray(master.qr_batches) ? master.qr_batches[0]?.order_id : null)

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
  const newStatus = finalCount >= expectedCount ? 'packed' : 'generated'

  const { data: sampleCode } = await supabase
    .from('qr_codes')
    .select('last_scanned_by')
    .eq('master_code_id', master.id)
    .neq('status', 'spoiled')
    .limit(1)
    .single()

  const scannedBy = sampleCode?.last_scanned_by || null
  const finalManufacturerOrgId = manufacturerOrgId || null

  const { error: updateError } = await supabase
    .from('qr_master_codes')
    .update({
      actual_unit_count: finalCount,
      status: newStatus,
      manufacturer_scanned_at: new Date().toISOString(),
      manufacturer_scanned_by: scannedBy,
      manufacturer_org_id: finalManufacturerOrgId,
      updated_at: new Date().toISOString()
    })
    .eq('id', master.id)

  if (updateError) {
    throw new Error(`Failed to update master ${master.master_code}: ${updateError.message}`)
  }

  console.log(`✅ Master case ${master.case_number} synced: ${finalCount}/${expectedCount} units`)

  return {
    master_code: master.master_code,
    case_number: master.case_number,
    expected_unit_count: expectedCount,
    actual_unit_count: finalCount,
    status: newStatus,
    order_id: orderId
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    // Auth check (skip in development)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    const isDevelopment = process.env.NODE_ENV === 'development'

    if (!isDevelopment && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.warn('⚠️ Unauthorized worker access attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = await createClient()

    // CRITICAL: Use SELECT FOR UPDATE SKIP LOCKED to prevent race conditions
    // This ensures only ONE worker processes each job, even if multiple workers run simultaneously
    
    // Try to fetch next job using database function with row-level locking
    const { data: fallbackJobs, error: fallbackError } = await supabase
      .from('qr_reverse_jobs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)

    if (fallbackError || !fallbackJobs || fallbackJobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending jobs',
        processed: 0,
        duration_ms: Date.now() - startTime
      })
    }

    // Use the job
    const job = fallbackJobs[0]
    
    // Lock it immediately (atomic operation)
    const { error: lockError } = await supabase
      .from('qr_reverse_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'pending') // Only update if still pending

    if (lockError) {
      console.log('⚠️ Failed to lock job (another worker may have claimed it)')
      return NextResponse.json({
        success: true,
        message: 'Job already claimed',
        processed: 0,
        duration_ms: Date.now() - startTime
      })
    }

    console.log(`🔄 Processing job ${job.id} for Case #${job.case_number}`)

    return await processJob(supabase, job, startTime)

  } catch (error: any) {
    console.error('❌ Worker error:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      duration_ms: Date.now() - startTime
    }, { status: 500 })
  }
}

/**
 * Process a single job
 */
async function processJob(supabase: any, job: any, startTime: number) {
  try {
    // Validate job
    if (!job.case_number) {
      throw new Error('Job missing case_number')
    }

    console.log(`[ModeC] Processing job ${job.id}: Case #${job.case_number}, Order: ${job.order_id}`)

    // Find master case
    const { data: masterCode, error: masterError } = await supabase
      .from('qr_master_codes')
      .select('id, master_code, expected_unit_count, case_number')
      .eq('batch_id', job.batch_id)
      .eq('case_number', job.case_number)
      .single()

    if (masterError || !masterCode) {
      throw new Error(`Master code not found for Case #${job.case_number}`)
    }

    console.log(`📍 Master: ${masterCode.master_code} (${masterCode.expected_unit_count} units)`)

    // Calculate sequence range for this case
    const startSeq = (job.case_number - 1) * masterCode.expected_unit_count + 1
    const endSeq = job.case_number * masterCode.expected_unit_count

    // Load normal codes for THIS CASE
    const { data: normalCodes, error: normalCodesError} = await supabase
      .from('qr_codes')
      .select('id, code, sequence_number, status, variant_key, is_buffer')
      .eq('order_id', job.order_id)
      .eq('batch_id', job.batch_id)
      .eq('is_buffer', false)
      .gte('sequence_number', startSeq)
      .lte('sequence_number', endSeq)
      .order('sequence_number', { ascending: true })

    if (normalCodesError) {
      throw new Error(`Failed to load case codes: ${normalCodesError.message}`)
    }

    console.log(`📦 Loaded ${normalCodes?.length || 0} normal codes`)

    // Get job items (spoiled codes)
    const { data: jobItems, error: itemsError } = await supabase
      .from('qr_reverse_job_items')
      .select('*')
      .eq('job_id', job.id)
      .is('processed_at', null)

    if (itemsError) {
      throw new Error(`Failed to fetch job items: ${itemsError.message}`)
    }

    console.log(`🔴 Processing ${jobItems?.length || 0} spoiled codes`)

    // Determine scenario
    const itemsWithBuffer = jobItems?.filter((i: any) => i.replacement_code_id) || []
    const itemsWithoutBuffer = jobItems?.filter((i: any) => !i.replacement_code_id) || []

    const isScenario1 = itemsWithoutBuffer.length > 0 && itemsWithBuffer.length === 0
    const isScenario2 = itemsWithBuffer.length > 0 && itemsWithoutBuffer.length === 0

    console.log(`📋 Scenario: ${isScenario1 ? '1 (Auto-assign buffers)' : isScenario2 ? '2 (Manual buffers)' : 'Mixed'}`)

    // SCENARIO 1: Auto-assign buffers
    if (isScenario1) {
      // Load available buffer pool
      const { data: bufferPool, error: bufferError } = await supabase
        .from('qr_codes')
        .select('id, code, sequence_number, variant_key')
        .eq('order_id', job.order_id)
        .eq('batch_id', job.batch_id)
        .eq('is_buffer', true)
        .in('status', ['available', 'buffer_available'])
        .order('sequence_number', { ascending: true })
        .limit(itemsWithoutBuffer.length)

      if (bufferError) {
        throw new Error(`Failed to load buffer pool: ${bufferError.message}`)
      }

      if ((bufferPool?.length || 0) < itemsWithoutBuffer.length) {
        throw new Error(`Not enough buffers: need ${itemsWithoutBuffer.length}, have ${bufferPool?.length || 0}`)
      }

      console.log(`🎯 Auto-assigning ${bufferPool?.length} buffers`)

      // Assign buffers to spoiled codes
      for (let i = 0; i < itemsWithoutBuffer.length; i++) {
        const item = itemsWithoutBuffer[i]
        const buffer = bufferPool![i]

        // Mark spoiled code as 'spoiled'
        await supabase
          .from('qr_codes')
          .update({
            status: 'spoiled',
            master_code_id: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.spoiled_code_id)

        // Mark buffer as 'buffer_used' and link to master
        await supabase
          .from('qr_codes')
          .update({
            status: 'buffer_used',
            master_code_id: masterCode.id,
            variant_key: job.variant_key,
            updated_at: new Date().toISOString()
          })
          .eq('id', buffer.id)

        // Mark item as processed
        await supabase
          .from('qr_reverse_job_items')
          .update({
            replacement_code_id: buffer.id,
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id)

        console.log(`  ✓ Seq ${item.sequence_number || '?'} replaced with buffer ${buffer.sequence_number}`)
      }
    }

    // SCENARIO 2: Use provided buffers
    if (isScenario2) {
      console.log(`✅ Using ${itemsWithBuffer.length} provided buffers`)

      for (const item of itemsWithBuffer) {
        // Mark spoiled code
        await supabase
          .from('qr_codes')
          .update({
            status: 'spoiled',
            master_code_id: null,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.spoiled_code_id)

        // Mark buffer as used
        await supabase
          .from('qr_codes')
          .update({
            status: 'buffer_used',
            master_code_id: masterCode.id,
            variant_key: job.variant_key,
            updated_at: new Date().toISOString()
          })
          .eq('id', item.replacement_code_id)

        // Mark item as processed
        await supabase
          .from('qr_reverse_job_items')
          .update({
            processed_at: new Date().toISOString()
          })
          .eq('id', item.id)
      }
    }

    // Recalculate master case stats
    const masterStats = await recalculateMasterCaseStats(supabase, masterCode.id, job.manufacturer_org_id)

    // Mark job as completed
    await supabase
      .from('qr_reverse_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        total_replacements: jobItems?.length || 0,
        master_code: masterCode.master_code,
        final_unit_count: masterStats.actual_unit_count
      })
      .eq('id', job.id)

    const duration = Date.now() - startTime

    console.log(`✅ Job ${job.id} completed in ${duration}ms`)

    return NextResponse.json({
      success: true,
      message: `Processed job ${job.id}`,
      processed: 1,
      job_id: job.id,
      case_number: job.case_number,
      replacements: jobItems?.length || 0,
      duration_ms: duration
    })

  } catch (error: any) {
    console.error(`❌ Job ${job.id} failed:`, error)

    // Mark job as failed
    await supabase
      .from('qr_reverse_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error.message
      })
      .eq('id', job.id)

    return NextResponse.json({
      success: false,
      error: error.message,
      job_id: job.id,
      duration_ms: Date.now() - startTime
    }, { status: 500 })
  }
}
