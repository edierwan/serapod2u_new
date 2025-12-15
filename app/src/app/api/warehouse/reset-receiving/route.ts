import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/warehouse/reset-receiving
 * Reset a stuck batch receiving process
 * This will set receiving_status back to 'idle' so the user can restart
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const { batch_id } = await request.json()

  if (!batch_id) {
    return NextResponse.json({ error: 'Batch ID is required' }, { status: 400 })
  }

  // Get current batch status
  const { data: batch, error: fetchError } = await supabase
    .from('qr_batches')
    .select('id, receiving_status')
    .eq('id', batch_id)
    .single()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!batch) {
    return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
  }

  // Only allow reset if stuck in processing, queued, or failed
  if (!['processing', 'queued', 'failed', 'cancelled'].includes(batch.receiving_status)) {
    return NextResponse.json({ 
      error: 'Batch is not in a resettable state', 
      current_status: batch.receiving_status 
    }, { status: 400 })
  }

  // Reset to idle with cleared heartbeat fields
  const { error: updateError } = await supabase
    .from('qr_batches')
    .update({ 
      receiving_status: 'idle',
      receiving_heartbeat: null,
      receiving_worker_id: null,
      receiving_progress: 0,
      receiving_started_at: null,
      receiving_completed_at: null,
      last_error: `Reset by user ${user.id} at ${new Date().toISOString()}`
    })
    .eq('id', batch_id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  console.log(`🔄 Batch ${batch_id} receiving status reset to idle by user ${user.id}`)

  return NextResponse.json({ 
    success: true, 
    message: 'Batch receiving status reset to idle. You can now restart the process.',
    previous_status: batch.receiving_status
  })
}
