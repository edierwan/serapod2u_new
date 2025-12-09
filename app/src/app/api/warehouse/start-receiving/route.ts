import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { batch_id } = await request.json()

  if (!batch_id) {
    return NextResponse.json({ error: 'Batch ID is required' }, { status: 400 })
  }

  // Check current status
  const { data: batch, error: fetchError } = await supabase
    .from('qr_batches')
    .select('receiving_status')
    .eq('id', batch_id)
    .single()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (batch.receiving_status === 'completed') {
    return NextResponse.json({ message: 'Already received' })
  }

  if (batch.receiving_status === 'queued' || batch.receiving_status === 'processing') {
    return NextResponse.json({ message: 'Receiving already in progress' })
  }

  // Set to queued
  // We use last_error to temporarily store the user ID who started the process
  // since we don't have an updated_by column and can't easily add one.
  const metadata = JSON.stringify({ received_by: user?.id })
  
  const { error: updateError } = await supabase
    .from('qr_batches')
    .update({ 
      receiving_status: 'queued',
      last_error: metadata,
      updated_at: new Date().toISOString()
    })
    .eq('id', batch_id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, status: 'queued' })
}
