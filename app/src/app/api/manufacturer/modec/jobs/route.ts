import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            )
        }

        const searchParams = request.nextUrl.searchParams
        const order_id = searchParams.get('order_id')
        const batch_id = searchParams.get('batch_id')

        if (!order_id || !batch_id) {
            return NextResponse.json(
                { error: 'Missing required parameters: order_id, batch_id' },
                { status: 400 }
            )
        }

        // Fetch jobs for this batch
        const { data: jobs, error: jobsError } = await supabase
            .from('qr_reverse_jobs')
            .select(`
        id,
        case_number,
        variant_key,
        status,
        total_spoiled,
        total_replacements,
        master_code,
        master_code_id,
        final_unit_count,
        error_message,
        created_at,
        started_at,
        completed_at,
        created_by,
        expected_units_per_case
      `)
            .eq('order_id', order_id)
            .eq('batch_id', batch_id)
            .order('created_at', { ascending: false })

        if (jobsError) {
            console.error('❌ Error fetching jobs:', jobsError)
            return NextResponse.json(
                { error: 'Failed to fetch jobs' },
                { status: 500 }
            )
        }

        // For each job, get item counts
        const jobsWithCounts = await Promise.all(
            (jobs || []).map(async (job) => {
                const { data: items } = await supabase
                    .from('qr_reverse_job_items')
                    .select('id, spoiled_sequence_no, replacement_sequence_no, replacement_code_id, processed_at, status')
                    .eq('job_id', job.id)

                const totalItems = items?.length || 0

                // For completed jobs, get ACTUAL counts from DATABASE (not from job_items)
                let actualSpoiledCount = 0
                let actualBufferUsedCount = 0
                let unassignedSequences: number[] = []
                
                if (job.status === 'completed' && job.case_number) {
                    // Count ACTUAL spoiled codes from qr_codes table
                    const { count: spoiledCount } = await supabase
                        .from('qr_codes')
                        .select('*', { count: 'exact', head: true })
                        .eq('batch_id', batch_id)
                        .eq('case_number', job.case_number)
                        .eq('status', 'spoiled')
                    
                    actualSpoiledCount = spoiledCount || 0
                    
                    // Count ACTUAL buffer_used codes from qr_codes table
                    const { count: bufferUsedCount, data: bufferUsedData } = await supabase
                        .from('qr_codes')
                        .select('sequence_number, replaces_sequence_no', { count: 'exact' })
                        .eq('batch_id', batch_id)
                        .eq('case_number', job.case_number)
                        .eq('status', 'buffer_used')
                    
                    actualBufferUsedCount = bufferUsedCount || 0
                    console.log(`[Jobs API] Case #${job.case_number}: Buffer used count=${actualBufferUsedCount}, buffers:`, bufferUsedData?.map(b => `${b.sequence_number}→${b.replaces_sequence_no}`).join(', '))
                    
                    // Get spoiled codes that DON'T have buffer replacements
                    // Check: spoiled codes where NO buffer has replaces_sequence_no pointing to them
                    const { data: spoiledCodes } = await supabase
                        .from('qr_codes')
                        .select('sequence_number')
                        .eq('batch_id', batch_id)
                        .eq('case_number', job.case_number)
                        .eq('status', 'spoiled')
                        .order('sequence_number', { ascending: true })
                    
                    if (spoiledCodes && spoiledCodes.length > 0) {
                        // Get all buffer codes that replaced spoiled codes in this case
                        const { data: bufferReplacements } = await supabase
                            .from('qr_codes')
                            .select('replaces_sequence_no')
                            .eq('batch_id', batch_id)
                            .eq('case_number', job.case_number)
                            .eq('status', 'buffer_used')
                            .not('replaces_sequence_no', 'is', null)
                        
                        const replacedSequences = new Set(bufferReplacements?.map(b => b.replaces_sequence_no) || [])
                        
                        console.log(`[Jobs API] Case #${job.case_number}: Total spoiled=${spoiledCodes.length}, Replaced sequences:`, Array.from(replacedSequences))
                        
                        // Only include spoiled codes that were NOT replaced
                        unassignedSequences = spoiledCodes
                            .filter(c => !replacedSequences.has(c.sequence_number))
                            .map(c => c.sequence_number)
                        
                        console.log(`[Jobs API] Case #${job.case_number}: Unassigned spoiled codes:`, unassignedSequences)
                    }
                }

                // For non-completed jobs, use job_items status
                const replacedItems = items?.filter(i => i.status === 'replaced' && i.replacement_code_id !== null).length || 0
                const spoiledOnlyItems = items?.filter(i => i.status === 'spoiled_only').length || 0
                const skippedItems = items?.filter(i => i.status === 'skipped').length || 0
                const failedItems = items?.filter(i => i.status === 'failed').length || 0
                const pendingItems = items?.filter(i => i.status === 'pending' || !i.processed_at).length || 0

                // Use DB counts for completed jobs, job_items for others
                const spoiledCount = job.status === 'completed' ? actualSpoiledCount : (replacedItems + spoiledOnlyItems + failedItems)
                const bufferUsedCount = job.status === 'completed' ? actualBufferUsedCount : replacedItems

                // Pending = items waiting for buffer scan (spoiled_only) + items not yet processed
                const pendingCount = spoiledOnlyItems + pendingItems

                // Calculate progress based on final_unit_count if available
                const totalExpected = job.expected_units_per_case || 100
                const currentCount = job.final_unit_count || 0
                const progressPct = totalExpected > 0 ? (currentCount / totalExpected) * 100 : 0

                // Determine if job can be cancelled
                const canCancel = job.status === 'queued' || job.status === 'running'

                return {
                    ...job,
                    spoiled: spoiledCount,
                    replaced: bufferUsedCount,
                    pending: pendingCount,
                    skipped: skippedItems,
                    total_items: totalItems,
                    canCancel,
                    // Progress tracking fields
                    current_count: currentCount,
                    total_expected: totalExpected,
                    progress_pct: progressPct,
                    // For backward compatibility
                    pending_items: pendingCount,
                    replaced_items: bufferUsedCount,
                    // Unassigned spoiled codes (no buffer replacement) - FROM DATABASE
                    unassigned_count: unassignedSequences.length,
                    unassigned_sequences: unassignedSequences
                }
            })
        )

        return NextResponse.json({
            success: true,
            jobs: jobsWithCounts
        })

    } catch (error: any) {
        console.error('❌ Get jobs error:', error)
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        )
    }
}

/**
 * Bulk delete Mode C jobs with buffer cleanup
 * 
 * DELETE /api/manufacturer/modec/jobs?filter=failed|completed|all&order_id=xxx&batch_id=xxx
 */
export async function DELETE(request: NextRequest) {
    try {
        const supabase = await createClient()

        // Get current user
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            )
        }

        const searchParams = request.nextUrl.searchParams
        const order_id = searchParams.get('order_id')
        const batch_id = searchParams.get('batch_id')
        const filter = searchParams.get('filter') // 'failed', 'completed', 'all'

        if (!order_id || !batch_id) {
            return NextResponse.json(
                { error: 'Missing required parameters: order_id, batch_id' },
                { status: 400 }
            )
        }

        // Build job query
        let jobQuery = supabase
            .from('qr_reverse_jobs')
            .select('id, status, case_number, manufacturer_org_id')
            .eq('order_id', order_id)
            .eq('batch_id', batch_id)

        // Apply filter
        if (filter === 'failed') {
            jobQuery = jobQuery.eq('status', 'failed')
        } else if (filter === 'completed') {
            jobQuery = jobQuery.eq('status', 'completed')
        } else if (filter === 'all') {
            jobQuery = jobQuery.in('status', ['failed', 'completed', 'cancelled', 'partial'])
        } else {
            return NextResponse.json(
                { error: 'Invalid filter. Must be: failed, completed, or all' },
                { status: 400 }
            )
        }

        const { data: jobs, error: fetchError } = await jobQuery

        if (fetchError) {
            console.error('❌ Failed to fetch jobs:', fetchError)
            return NextResponse.json(
                { error: 'Failed to fetch jobs' },
                { status: 500 }
            )
        }

        if (!jobs || jobs.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No jobs to delete',
                deleted_count: 0,
                reverted_buffers: 0
            })
        }

        // Verify user belongs to manufacturer organization
        const { data: userProfile } = await supabase
            .from('users')
            .select('organization_id')
            .eq('id', user.id)
            .single()

        if (!userProfile) {
            return NextResponse.json(
                { error: 'User profile not found' },
                { status: 404 }
            )
        }

        // Check authorization for all jobs
        const unauthorizedJobs = jobs.filter(job => job.manufacturer_org_id !== userProfile.organization_id)
        if (unauthorizedJobs.length > 0) {
            return NextResponse.json(
                { error: 'Unauthorized - some jobs belong to other organizations' },
                { status: 403 }
            )
        }

        // Create service client for deletion
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseServiceKey) {
            console.error('❌ Missing Supabase credentials')
            return NextResponse.json(
                { error: 'Server configuration error' },
                { status: 500 }
            )
        }

        const supabaseAdmin = createServiceClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        })

        const jobIds = jobs.map(j => j.id)
        let totalRevertedBuffers = 0

        console.log(`[ModeC] Bulk deleting ${jobIds.length} jobs...`)

        // STEP 1: Revert all buffer codes used by these jobs
        const { data: allJobItems } = await supabaseAdmin
            .from('qr_reverse_job_items')
            .select('replacement_code_id, replacement_sequence_no')
            .in('job_id', jobIds)
            .not('replacement_code_id', 'is', null)

        if (allJobItems && allJobItems.length > 0) {
            const bufferCodeIds = allJobItems.map(item => item.replacement_code_id).filter(Boolean)

            if (bufferCodeIds.length > 0) {
                const { data: revertedBuffers, error: revertError } = await supabaseAdmin
                    .from('qr_codes')
                    .update({
                        status: 'buffer_available',
                        replaces_sequence_no: null,
                        updated_at: new Date().toISOString()
                    })
                    .in('id', bufferCodeIds)
                    .eq('status', 'buffer_used')
                    .select('sequence_number')

                if (revertError) {
                    console.error('❌ Failed to revert buffer codes:', revertError)
                } else {
                    totalRevertedBuffers = revertedBuffers?.length || 0
                    console.log(`✅ Reverted ${totalRevertedBuffers} buffer codes`)
                }
            }
        }

        // STEP 2: Delete job items
        const { error: deleteItemsError } = await supabaseAdmin
            .from('qr_reverse_job_items')
            .delete()
            .in('job_id', jobIds)

        if (deleteItemsError) {
            console.error('❌ Failed to delete job items:', deleteItemsError)
            return NextResponse.json(
                { error: 'Failed to delete job items', details: deleteItemsError.message },
                { status: 500 }
            )
        }

        // STEP 3: Delete jobs
        const { data: deletedJobs, error: deleteJobsError } = await supabaseAdmin
            .from('qr_reverse_jobs')
            .delete()
            .in('id', jobIds)
            .select('id, case_number')

        if (deleteJobsError) {
            console.error('❌ Failed to delete jobs:', deleteJobsError)
            return NextResponse.json(
                { error: 'Failed to delete jobs', details: deleteJobsError.message },
                { status: 500 }
            )
        }

        console.log(`✅ Bulk delete complete:`, {
            deleted_jobs: deletedJobs?.length || 0,
            reverted_buffers: totalRevertedBuffers,
            filter
        })

        return NextResponse.json({
            success: true,
            message: `Successfully deleted ${deletedJobs?.length || 0} job(s). ${totalRevertedBuffers} buffer code(s) reverted and available for reuse.`,
            deleted_count: deletedJobs?.length || 0,
            reverted_buffers: totalRevertedBuffers
        })

    } catch (error: any) {
        console.error('❌ Bulk delete error:', error)
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        )
    }
}
