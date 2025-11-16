import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Cancel a Mode C reverse job
 * 
 * POST /api/manufacturer/modec/jobs/[jobId]/cancel
 * 
 * Only allows cancellation if:
 * - Job status is 'queued' or 'running'
 * - User has access to the order/batch
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ jobId: string }> }
) {
    try {
        const supabase = await createClient()
        const { jobId } = await params

        // Get current user
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            )
        }

        // Fetch the job
        const { data: job, error: fetchError } = await supabase
            .from('qr_reverse_jobs')
            .select('id, status, order_id, batch_id, case_number, created_by, manufacturer_org_id, error_message')
            .eq('id', jobId)
            .single()

        if (fetchError || !job) {
            return NextResponse.json(
                { error: 'Job not found' },
                { status: 404 }
            )
        }

        // Verify user belongs to manufacturer organization
        // Get user's organization from users table
        const { data: userProfile } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        if (!userProfile || userProfile.organization_id !== job.manufacturer_org_id) {
            return NextResponse.json(
                { error: 'Unauthorized - not a member of manufacturer organization' },
                { status: 403 }
            )
        }

        // Check if job can be cancelled (only queued or running)
        if (job.status !== 'queued' && job.status !== 'running') {
            return NextResponse.json(
                {
                    error: `Cannot cancel job with status '${job.status}'. Only queued or running jobs can be cancelled.`,
                    current_status: job.status
                },
                { status: 400 }
            )
        }

        // Cancel the job
        const { data: cancelledJob, error: cancelError } = await supabase
            .from('qr_reverse_jobs')
            .update({
                status: 'cancelled',
                completed_at: new Date().toISOString(),
                cancelled_at: new Date().toISOString(),
                cancelled_by: user.id,
                error_message: job.error_message || 'Cancelled by user from UI'
            })
            .eq('id', jobId)
            .select()
            .single()

        if (cancelError) {
            console.error('Failed to cancel job:', cancelError)
            return NextResponse.json(
                { error: 'Failed to cancel job' },
                { status: 500 }
            )
        }

        console.log(`[ModeC] Job cancelled by user`, {
            jobId: job.id,
            caseNumber: job.case_number,
            userId: user.id,
            previousStatus: job.status
        })

        return NextResponse.json({
            success: true,
            message: 'Job cancelled successfully',
            job: cancelledJob
        })

    } catch (error: any) {
        console.error('Error cancelling job:', error)
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        )
    }
}
