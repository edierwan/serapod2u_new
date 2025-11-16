import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const searchParams = request.nextUrl.searchParams
    const job_id = searchParams.get('job_id')
    
    if (!job_id) {
      return NextResponse.json(
        { error: 'Missing job_id parameter' },
        { status: 400 }
      )
    }
    
    // Fetch job with master code info if available
    const { data: job, error: jobError } = await supabase
      .from('qr_reverse_jobs')
      .select(`
        id,
        status,
        case_number,
        variant_key,
        total_spoiled,
        total_replacements,
        master_code,
        final_unit_count,
        error_message,
        created_at,
        started_at,
        completed_at,
        master_code_id
      `)
      .eq('id', job_id)
      .single()
    
    if (jobError || !job) {
      console.error('❌ Job not found:', job_id, jobError)
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      )
    }
    
    // If job is completed, fetch replacement details
    let replacements: any[] = []
    if (job.status === 'completed') {
      const { data: items } = await supabase
        .from('qr_reverse_job_items')
        .select(`
          spoiled_sequence_no,
          replacement_sequence_no,
          spoiled_codes:spoiled_code_id(code, status),
          replacement_codes:replacement_code_id(code, status)
        `)
        .eq('job_id', job_id)
        .order('spoiled_sequence_no', { ascending: true })
      
      replacements = items || []
    }
    
    // Build response based on status
    const response: any = {
      job_id: job.id,
      status: job.status,
      case_number: job.case_number,
      variant_key: job.variant_key,
      total_spoiled: job.total_spoiled,
      created_at: job.created_at
    }
    
    if (job.status === 'running') {
      response.started_at = job.started_at
      response.message = 'Job is currently processing...'
    }
    
    if (job.status === 'completed') {
      response.total_replacements = job.total_replacements
      response.master_code = job.master_code
      response.final_unit_count = job.final_unit_count
      response.completed_at = job.completed_at
      response.replacements = replacements
      response.message = `Case #${job.case_number} completed with ${job.total_replacements} replacement(s)`
    }
    
    if (job.status === 'failed') {
      response.error_message = job.error_message
      response.message = 'Job failed. Please try again or contact support.'
    }
    
    return NextResponse.json(response)
    
  } catch (error: any) {
    console.error('❌ Job status error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
