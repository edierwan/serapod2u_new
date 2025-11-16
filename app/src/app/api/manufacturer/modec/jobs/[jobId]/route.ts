import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/**
 * Delete a Mode C reverse job from history
 * 
 * DELETE /api/manufacturer/modec/jobs/[jobId]
 * 
 * Only allows deletion if:
 * - Job status is 'cancelled', 'failed', or 'completed'
 * - User has access to the order/batch
 * 
 * Note: Uses service role for deletion to bypass RLS (no DELETE policy exists)
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ jobId: string }> }
) {
    try {
        const supabase = await createClient()
        const { jobId } = await params

        // Get current user for authorization check
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
            .select('id, status, order_id, batch_id, case_number, created_by, manufacturer_org_id')
            .eq('id', jobId)
            .single()

        if (fetchError || !job) {
            return NextResponse.json(
                { error: 'Job not found' },
                { status: 404 }
            )
        }

        // Verify user belongs to manufacturer organization
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

        // Check if job can be deleted (only cancelled, failed, completed, or partial)
        // partial = job is done processing but waiting for buffer scans
        if (!['cancelled', 'failed', 'completed', 'partial'].includes(job.status)) {
            return NextResponse.json(
                {
                    error: `Cannot delete job with status '${job.status}'. Only cancelled, failed, completed, or partial jobs can be deleted.`,
                    current_status: job.status
                },
                { status: 400 }
            )
        }

        // Create service client for deletion (bypasses RLS - no DELETE policy exists)
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseServiceKey) {
            console.error('❌ Missing Supabase credentials for service role')
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

        // STEP 1: Revert master code status from 'packed' to 'generated'
        console.log(`[ModeC] Reverting master code for case ${job.case_number}...`)
        const { data: masterCode } = await supabaseAdmin
            .from('qr_master_codes')
            .select('id, master_code, status')
            .eq('batch_id', job.batch_id)
            .eq('case_number', job.case_number)
            .single()
        
        if (masterCode && masterCode.status === 'packed') {
            const { error: revertMasterError } = await supabaseAdmin
                .from('qr_master_codes')
                .update({
                    status: 'printed',
                    manufacturer_scanned_at: null,
                    manufacturer_scanned_by: null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', masterCode.id)
            
            if (revertMasterError) {
                console.error('❌ Failed to revert master code:', revertMasterError)
            } else {
                console.log(`✅ Reverted master code ${masterCode.master_code} from 'packed' to 'printed'`)
            }
        }

        // STEP 2: Revert unique QR codes from 'packed' to 'printed'
        console.log(`[ModeC] Reverting unique codes for case ${job.case_number}...`)
        const { data: revertedUniqueCodes, error: revertUniqueError } = await supabaseAdmin
            .from('qr_codes')
            .update({
                status: 'printed',
                updated_at: new Date().toISOString()
            })
            .eq('batch_id', job.batch_id)
            .eq('case_number', job.case_number)
            .eq('is_buffer', false)
            .eq('status', 'packed')
            .select('sequence_number')
        
        if (revertUniqueError) {
            console.error('❌ Failed to revert unique codes:', revertUniqueError)
        } else {
            console.log(`✅ Reverted ${revertedUniqueCodes?.length || 0} unique codes from 'packed' to 'printed'`)
        }

        // STEP 3: Revert buffer codes used by this job
        console.log(`[ModeC] Reverting buffer codes for job ${jobId}...`)
        
        // Find all buffer codes that were used by this job's items
        const { data: jobItems } = await supabaseAdmin
            .from('qr_reverse_job_items')
            .select('replacement_code_id, replacement_sequence_no, spoiled_sequence_no')
            .eq('job_id', jobId)
            .not('replacement_code_id', 'is', null)
        
        if (jobItems && jobItems.length > 0) {
            const bufferCodeIds = jobItems.map(item => item.replacement_code_id).filter(Boolean)
            
            if (bufferCodeIds.length > 0) {
                const { data: revertedBuffers, error: revertError } = await supabaseAdmin
                    .from('qr_codes')
                    .update({
                        status: 'buffer_available',
                        replaces_sequence_no: null,
                        updated_at: new Date().toISOString()
                    })
                    .in('id', bufferCodeIds)
                    .eq('status', 'buffer_used') // Only revert if currently marked as used
                    .select('sequence_number')
                
                if (revertError) {
                    console.error('❌ Failed to revert buffer codes:', revertError)
                    // Continue with deletion even if revert fails (job still needs to be deleted)
                } else {
                    console.log(`✅ Reverted ${revertedBuffers?.length || 0} buffer codes:`, revertedBuffers?.map(b => b.sequence_number).join(', '))
                }
            }
            
            // STEP 4: Revert spoiled codes back to their original status (before spoiling)
            const spoiledSequences = jobItems.map(item => item.spoiled_sequence_no).filter(Boolean)
            if (spoiledSequences.length > 0) {
                const { data: revertedSpoiled, error: revertSpoiledError } = await supabaseAdmin
                    .from('qr_codes')
                    .update({
                        status: 'printed', // Revert spoiled codes back to 'printed'
                        updated_at: new Date().toISOString()
                    })
                    .eq('batch_id', job.batch_id)
                    .in('sequence_number', spoiledSequences)
                    .eq('status', 'spoiled')
                    .select('sequence_number')
                
                if (revertSpoiledError) {
                    console.error('❌ Failed to revert spoiled codes:', revertSpoiledError)
                } else {
                    console.log(`✅ Reverted ${revertedSpoiled?.length || 0} spoiled codes back to 'printed'`)
                }
            }
        }

        // STEP 5: Delete the job items (foreign key constraint)
        console.log(`[ModeC] Deleting job items for job ${jobId}...`)
        const { data: deletedItems, error: deleteItemsError } = await supabaseAdmin
            .from('qr_reverse_job_items')
            .delete()
            .eq('job_id', jobId)
            .select('id')

        if (deleteItemsError) {
            console.error('❌ Failed to delete job items:', deleteItemsError)
            return NextResponse.json(
                {
                    error: 'Failed to delete job items',
                    details: deleteItemsError.message
                },
                { status: 500 }
            )
        }

        console.log(`✅ Deleted ${deletedItems?.length || 0} job items`)

        // Delete the job (using service role to bypass RLS)
        console.log(`[ModeC] Deleting job ${jobId}...`)
        const { data: deletedJob, error: deleteJobError } = await supabaseAdmin
            .from('qr_reverse_jobs')
            .delete()
            .eq('id', jobId)
            .select('id')

        if (deleteJobError) {
            console.error('❌ Failed to delete job:', deleteJobError)
            return NextResponse.json(
                {
                    error: 'Failed to delete job',
                    details: deleteJobError.message
                },
                { status: 500 }
            )
        }

        if (!deletedJob || deletedJob.length === 0) {
            console.warn('⚠️ No job was deleted - job may have been removed already')
            return NextResponse.json(
                {
                    error: 'Job not deleted - may have been removed already',
                    hint: 'The job might not exist in the database'
                },
                { status: 404 }
            )
        }

        console.log(`✅ Job deleted successfully`, {
            jobId: job.id,
            caseNumber: job.case_number,
            userId: user.id,
            previousStatus: job.status
        })

        return NextResponse.json({
            success: true,
            message: 'Job deleted successfully. Buffer codes have been reverted and are available for reuse.'
        })

    } catch (error: any) {
        console.error('Error deleting job:', error)
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        )
    }
}
