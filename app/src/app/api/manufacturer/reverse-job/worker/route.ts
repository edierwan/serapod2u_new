import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// This endpoint processes queued reverse batch jobs
// Can be called by a cron job or triggered manually
export async function POST(request: NextRequest) {
  try {
    // Verify this is an authorized request
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.CRON_SECRET || process.env.WORKER_SECRET || 'dev-worker-secret'
    
    if (authHeader !== `Bearer ${expectedToken}`) {
      console.error('Unauthorized worker attempt')
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Create admin/service client with elevated permissions
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase credentials')
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('🔄 Worker: Starting job processing...')

    // Find oldest queued job
    const { data: jobs, error: jobError } = await supabase
      .from('qr_reverse_jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1)

    if (jobError) {
      console.error('Error fetching queued jobs:', jobError)
      return NextResponse.json(
        { success: false, error: jobError.message },
        { status: 500 }
      )
    }

    if (!jobs || jobs.length === 0) {
      console.log('✅ No queued jobs found')
      return NextResponse.json({
        success: true,
        message: 'No jobs to process'
      })
    }

    const job = jobs[0]
    console.log(`📋 Processing job ${job.id} for batch ${job.batch_id}`)

    // Mark job as running
    await supabase
      .from('qr_reverse_jobs')
      .update({ status: 'running', progress: 5, updated_at: new Date().toISOString() })
      .eq('id', job.id)

    try {
      // Build query with optional filters for performance
      let query = supabase
        .from('qr_codes')
        .select(`
          id,
          code,
          master_code_id,
          status,
          batch_id,
          variant_id
        `)
        .eq('batch_id', job.batch_id)
      
      // Apply variant filter if specified
      if (job.filter_variant_id) {
        console.log(`🔍 Filtering by variant: ${job.filter_variant_id}`)
        query = query.eq('variant_id', job.filter_variant_id)
      }

      const { data: batchCodes, error: codesError } = await query

      if (codesError) {
        throw new Error(`Failed to fetch batch codes: ${codesError.message}`)
      }

      // Apply case number filter if specified (requires master code lookup)
      let filteredCodes = batchCodes || []
      if (job.filter_case_numbers && job.filter_case_numbers.length > 0) {
        console.log(`� Filtering by case numbers: ${job.filter_case_numbers.join(', ')}`)
        
        // Get master codes for the specified case numbers
        const { data: masterCodes, error: masterError } = await supabase
          .from('qr_master_codes')
          .select('id, case_number')
          .eq('batch_id', job.batch_id)
          .in('case_number', job.filter_case_numbers)
        
        if (masterError) {
          console.error('Error fetching master codes for case filter:', masterError)
        } else {
          const masterCodeIds = new Set(masterCodes?.map(m => m.id) || [])
          
          // Filter to only codes belonging to those master cases
          filteredCodes = filteredCodes.filter(code => 
            code.master_code_id && masterCodeIds.has(code.master_code_id)
          )
          
          console.log(`  → Reduced to ${filteredCodes.length} codes in specified cases`)
        }
      }

      console.log(`📦 Found ${filteredCodes.length} codes to process` + 
        (job.filter_variant_id ? ' (variant filtered)' : '') +
        (job.filter_case_numbers?.length > 0 ? ` (cases: ${job.filter_case_numbers.join(',')})` : ''))

      // Update progress
      await supabase
        .from('qr_reverse_jobs')
        .update({ progress: 20, updated_at: new Date().toISOString() })
        .eq('id', job.id)

      // Filter codes (exclude damaged/missing + already linked)
      const excludeSet = new Set(job.exclude_codes || [])
      const availableCodes = filteredCodes.filter(code => {
        // Exclude codes in the exclude list
        if (excludeSet.has(code.code)) {
          console.log(`  ⊘ Excluding: ${code.code}`)
          return false
        }
        
        // Exclude codes already linked to a master
        if (code.master_code_id) {
          return false
        }
        
        // Only include pending/generated/available codes
        if (code.status === 'packed' || code.status === 'scanned' || code.status === 'redeemed') {
          return false
        }
        
        return true
      })

      console.log(`✅ ${availableCodes.length} codes available after filtering`)

      const totalAvailable = availableCodes.length
      await supabase
        .from('qr_reverse_jobs')
        .update({ 
          total_available_in_batch: totalAvailable,
          remaining_to_prepare: totalAvailable,
          progress: 30,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)

      // Insert codes into prepared queue in batches
      let preparedCount = 0
      let duplicateCount = 0
      let invalidCount = 0
      const insertBatchSize = 100

      for (let i = 0; i < availableCodes.length; i += insertBatchSize) {
        const batch = availableCodes.slice(i, i + insertBatchSize)
        
        const preparedRecords = batch.map((code, index) => ({
          job_id: job.id,
          batch_id: job.batch_id,
          order_id: job.order_id,
          code: code.code,
          sequence_number: i + index + 1,
          status: 'prepared'
        }))

        // Use upsert to handle duplicates gracefully
        const { data: inserted, error: insertError } = await supabase
          .from('qr_prepared_codes')
          .upsert(preparedRecords, { 
            onConflict: 'order_id,batch_id,code',
            ignoreDuplicates: false 
          })
          .select('id')

        if (insertError) {
          console.error(`Error inserting batch ${i}-${i + batch.length}:`, insertError)
          // If it's a unique violation, count as duplicate
          if (insertError.code === '23505') {
            duplicateCount += batch.length
          } else {
            invalidCount += batch.length
          }
        } else {
          const insertedCount = inserted?.length || 0
          preparedCount += insertedCount
          duplicateCount += (batch.length - insertedCount)
        }

        // Update progress
        const progress = 30 + Math.round((i / availableCodes.length) * 60)
        await supabase
          .from('qr_reverse_jobs')
          .update({ 
            progress,
            prepared_count: preparedCount,
            remaining_to_prepare: totalAvailable - preparedCount - duplicateCount,
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id)

        console.log(`  Progress: ${progress}% (${preparedCount} prepared, ${duplicateCount} duplicates)`)

        // Small delay to avoid overwhelming DB
        if (availableCodes.length > insertBatchSize) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }

      // Mark job as completed
      const resultSummary = {
        prepared: preparedCount,
        duplicates: duplicateCount,
        invalid: invalidCount,
        total_available: totalAvailable,
        excluded_count: job.exclude_codes?.length || 0
      }

      await supabase
        .from('qr_reverse_jobs')
        .update({
          status: 'completed',
          progress: 100,
          prepared_count: preparedCount,
          remaining_to_prepare: 0,
          result_summary: resultSummary,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)

      console.log(`✅ Job ${job.id} completed:`, resultSummary)

      // Log success
      await supabase
        .from('qr_reverse_job_logs')
        .insert({
          job_id: job.id,
          level: 'info',
          message: `Job completed: ${preparedCount} codes prepared, ${duplicateCount} duplicates skipped, ${job.exclude_codes?.length || 0} excluded`
        })

      return NextResponse.json({
        success: true,
        job_id: job.id,
        result: resultSummary
      })

    } catch (error: any) {
      console.error(`❌ Error processing job ${job.id}:`, error)
      
      // Mark job as failed
      await supabase
        .from('qr_reverse_jobs')
        .update({
          status: 'failed',
          error_message: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id)

      // Log error
      await supabase
        .from('qr_reverse_job_logs')
        .insert({
          job_id: job.id,
          level: 'error',
          message: `Job failed: ${error.message}`
        })

      throw error
    }

  } catch (error: any) {
    console.error('❌ Worker error:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}

// Optional: GET endpoint to manually check worker status
export async function GET() {
  return NextResponse.json({
    worker: 'Reverse Batch Job Processor',
    version: '1.0.0',
    status: 'ready',
    info: 'POST with Bearer token to process queued jobs'
  })
}
