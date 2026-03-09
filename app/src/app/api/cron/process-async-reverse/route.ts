import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyCronAuth } from '@/lib/cron-auth'

// This endpoint should be called by a cron job or background worker
// Protected by CRON_SECRET via centralized cron auth

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    // Centralized cron auth check
    const authResult = verifyCronAuth(request)
    if (!authResult.ok) return authResult.response
    
    const supabase = await createClient()
    
    // Fetch all queued jobs
    const { data: queuedJobs, error: fetchError } = await supabase
      .from('qr_reverse_jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(10) // Process up to 10 jobs per run
    
    if (fetchError) {
      console.error('❌ Failed to fetch queued jobs:', fetchError)
      return NextResponse.json(
        { error: 'Failed to fetch jobs' },
        { status: 500 }
      )
    }
    
    if (!queuedJobs || queuedJobs.length === 0) {
      return NextResponse.json({
        message: 'No queued jobs to process',
        processed: 0
      })
    }
    
    console.log(`📋 Found ${queuedJobs.length} queued job(s) to process`)
    
    const results = []
    
    // Process each job
    for (const job of queuedJobs) {
      const jobStartTime = Date.now()
      console.log(`\n🔄 Processing job ${job.id} for Case #${job.case_number}`)
      
      try {
        // Mark job as running
        await supabase
          .from('qr_reverse_jobs')
          .update({
            status: 'running',
            started_at: new Date().toISOString()
          })
          .eq('id', job.id)
        
        // Get job items (spoiled codes)
        const { data: jobItems, error: itemsError } = await supabase
          .from('qr_reverse_job_items')
          .select('id, spoiled_code_id, spoiled_sequence_no')
          .eq('job_id', job.id)
        
        if (itemsError || !jobItems) {
          throw new Error(`Failed to fetch job items: ${itemsError?.message}`)
        }
        
        console.log(`📦 Processing ${jobItems.length} spoiled code(s)`)
        
        let replacementCount = 0
        
        // Process each spoiled code
        for (const item of jobItems) {
          // Fetch spoiled code details
          const { data: spoiledCode, error: spoiledCodeError } = await supabase
            .from('qr_codes')
            .select('id, code, sequence_number, status, batch_id')
            .eq('id', item.spoiled_code_id!)
            .single()
          
          if (spoiledCodeError || !spoiledCode) {
            console.warn(`⚠️ Spoiled code not found for item ${item.id}`)
            continue
          }
          
          console.log(`  🔴 Marking spoiled: Seq ${spoiledCode.sequence_number}`)
          
          // Step 1: Mark original code as spoiled
          const { error: spoilError } = await supabase
            .from('qr_codes')
            .update({
              status: 'spoiled',
              updated_at: new Date().toISOString()
            })
            .eq('id', spoiledCode.id)
          
          if (spoilError) {
            console.error(`❌ Failed to mark code as spoiled:`, spoilError)
            continue
          }
          
          // Step 2: Find available buffer code
          const { data: bufferCode, error: bufferError } = await supabase
            .from('qr_codes')
            .select('id, code, sequence_number')
            .eq('batch_id', spoiledCode.batch_id)
            .eq('is_buffer', true)
            .eq('status', 'buffer_available')
            .limit(1)
            .single()
          
          if (bufferError || !bufferCode) {
            console.error(`❌ No buffer code available:`, bufferError)
            throw new Error('No buffer codes available. Please ensure buffer codes exist in the batch.')
          }
          
          console.log(`  🟢 Using buffer: Seq ${bufferCode.sequence_number} → replaces Seq ${spoiledCode.sequence_number}`)
          
          // Step 3: Mark buffer code as used and assign to case
          const { error: useBufferError } = await supabase
            .from('qr_codes')
            .update({
              status: 'buffer_used',
              case_number: job.case_number,
              replaces_sequence_no: spoiledCode.sequence_number,
              updated_at: new Date().toISOString()
            })
            .eq('id', bufferCode.id)
          
          if (useBufferError) {
            console.error(`❌ Failed to mark buffer as used:`, useBufferError)
            throw new Error('Failed to update buffer code')
          }
          
          // Step 4: Update job item with replacement info
          const { error: updateItemError } = await supabase
            .from('qr_reverse_job_items')
            .update({
              replacement_code_id: bufferCode.id,
              replacement_sequence_no: bufferCode.sequence_number,
              processed_at: new Date().toISOString()
            })
            .eq('id', item.id)
          
          if (updateItemError) {
            console.error(`❌ Failed to update job item:`, updateItemError)
          }
          
          replacementCount++
        }
        
        console.log(`✅ Completed ${replacementCount} replacement(s)`)
        
        // Step 5: Auto-assign master case
        if (!job.case_number) {
          throw new Error('Job missing case_number')
        }
        
        console.log(`📍 Auto-assigning master case for Case #${job.case_number}`)
        
        // Find master code
        const { data: masterCode, error: masterError } = await supabase
          .from('qr_master_codes')
          .select('id, master_code, expected_unit_count, actual_unit_count, status')
          .eq('order_id', job.order_id)
          .eq('case_number', job.case_number)
          .single()
        
        if (masterError || !masterCode) {
          console.warn(`⚠️ Master code not found for Case #${job.case_number}`)
          // Complete job without master assignment
          await supabase
            .from('qr_reverse_jobs')
            .update({
              status: 'completed',
              total_replacements: replacementCount,
              completed_at: new Date().toISOString(),
              error_message: 'Master code not found for this case'
            })
            .eq('id', job.id)
          
          results.push({
            job_id: job.id,
            case_number: job.case_number,
            success: true,
            replacements: replacementCount,
            warning: 'Master code not found'
          })
          continue
        }
        
        // Count all valid codes for this case
        const { count: validCodeCount, error: countError } = await supabase
          .from('qr_codes')
          .select('id', { count: 'exact', head: true })
          .eq('batch_id', job.batch_id)
          .eq('case_number', job.case_number)
          .in('status', ['used_ok', 'buffer_used', 'packed'])
        
        const finalValidCount = validCodeCount ?? 0
        console.log(`📊 Case #${job.case_number}: ${finalValidCount} valid codes`)
        
        // Update master code
        const newStatus = finalValidCount >= masterCode.expected_unit_count ? 'packed' : 'partial'
        
        const { error: updateMasterError } = await supabase
          .from('qr_master_codes')
          .update({
            actual_unit_count: finalValidCount,
            status: newStatus,
            updated_at: new Date().toISOString()
          })
          .eq('id', masterCode.id)
        
        if (updateMasterError) {
          console.error(`❌ Failed to update master code:`, updateMasterError)
        }
        
        console.log(`✅ Master updated: ${finalValidCount}/${masterCode.expected_unit_count} - Status: ${newStatus}`)
        
        // Step 6: Complete the job
        const { error: completeError } = await supabase
          .from('qr_reverse_jobs')
          .update({
            status: 'completed',
            total_replacements: replacementCount,
            master_code_id: masterCode.id,
            master_code: masterCode.master_code,
            final_unit_count: finalValidCount,
            completed_at: new Date().toISOString()
          })
          .eq('id', job.id)
        
        if (completeError) {
          console.error(`❌ Failed to complete job:`, completeError)
        }
        
        const jobDuration = Date.now() - jobStartTime
        console.log(`✅ Job ${job.id} completed in ${jobDuration}ms`)
        
        results.push({
          job_id: job.id,
          case_number: job.case_number,
          success: true,
          replacements: replacementCount,
          final_unit_count: validCodeCount,
          master_code: masterCode.master_code,
          duration_ms: jobDuration
        })
        
      } catch (error: any) {
        console.error(`❌ Job ${job.id} failed:`, error)
        
        // Mark job as failed
        await supabase
          .from('qr_reverse_jobs')
          .update({
            status: 'failed',
            error_message: error.message,
            completed_at: new Date().toISOString()
          })
          .eq('id', job.id)
        
        results.push({
          job_id: job.id,
          case_number: job.case_number,
          success: false,
          error: error.message
        })
      }
    }
    
    const totalDuration = Date.now() - startTime
    console.log(`\n✅ Worker completed: ${results.length} job(s) in ${totalDuration}ms`)
    
    return NextResponse.json({
      success: true,
      processed: results.length,
      results,
      duration_ms: totalDuration
    })
    
  } catch (error: any) {
    console.error('❌ Worker error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
