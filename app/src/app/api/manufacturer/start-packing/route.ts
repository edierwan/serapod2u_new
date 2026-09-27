import { guardUserOperation } from '@/lib/security-access/operation'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user: saUser } } = await supabase.auth.getUser()
  if (!saUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const saDenied = await guardUserOperation(saUser.id, 'manufacturing.production.manage')
  if (saDenied) return saDenied
  const { batch_id } = await request.json()

  if (!batch_id) {
    return NextResponse.json({ error: 'Batch ID is required' }, { status: 400 })
  }

  // Check current status
  const { data: batch, error: fetchError } = await supabase
    .from('qr_batches')
    .select('packing_status')
    .eq('id', batch_id)
    .single()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (batch.packing_status === 'completed') {
    return NextResponse.json({ message: 'Already packed' })
  }

  if (batch.packing_status === 'queued' || batch.packing_status === 'processing') {
    return NextResponse.json({ message: 'Packing already in progress' })
  }

  // Set to queued
  const { error: updateError } = await supabase
    .from('qr_batches')
    .update({ packing_status: 'queued' })
    .eq('id', batch_id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, status: 'queued' })
}
