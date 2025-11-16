import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const job_id = searchParams.get('job_id')

    if (!job_id) {
      return NextResponse.json(
        { success: false, error: 'Missing job_id parameter' },
        { status: 400 }
      )
    }

    // Fetch job status
    const { data: job, error: jobError } = await supabase
      .from('qr_reverse_jobs')
      .select('*')
      .eq('id', job_id)
      .single()

    if (jobError || !job) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      )
    }

    // Verify user belongs to manufacturer org
    const { data: userProfile } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (!userProfile || userProfile.organization_id !== job.manufacturer_org_id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized to view this job' },
        { status: 403 }
      )
    }

    return NextResponse.json({
      success: true,
      job_id: job.id,
      status: job.status,
      progress: job.progress || 0,
      prepared_count: job.prepared_count || 0,
      remaining_to_prepare: job.remaining_to_prepare,
      total_available_in_batch: job.total_available_in_batch,
      result_summary: job.result_summary,
      error_message: job.error_message,
      created_at: job.created_at,
      updated_at: job.updated_at
    })

  } catch (error: any) {
    console.error('Error in reverse-job/status:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
