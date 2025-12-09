import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60 seconds

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const supabase = createAdminClient()

  try {
    // 1. Find a batch to process (queued or processing)
    const { data: batch, error: fetchError } = await supabase
      .from('qr_batches')
      .select('id, packing_status')
      .in('packing_status', ['queued', 'processing'])
      .order('created_at', { ascending: true }) // FIFO
      .limit(1)
      .single()

    if (fetchError || !batch) {
      return NextResponse.json({ message: 'No batches to pack' })
    }

    console.log(`📦 Packing batch ${batch.id} (Status: ${batch.packing_status})`)

    // 2. Update status to processing if needed
    if (batch.packing_status === 'queued') {
      const { error: updateError } = await supabase
        .from('qr_batches')
        .update({ packing_status: 'processing' })
        .eq('id', batch.id)
      
      if (updateError) {
        console.error('Error updating batch status:', updateError)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    }

    // 3. Process in chunks until timeout approaching
    let hasMore = true
    let processedCount = 0
    const CHUNK_SIZE = 200 // Reduced from 5000 to avoid URL length limits

    while (hasMore) {
      // Check time
      if (Date.now() - startTime > 50000) { // 50 seconds
        console.log('⏳ Time limit reached, yielding worker')
        return NextResponse.json({ 
          message: 'Time limit reached', 
          processed: processedCount,
          continue: true 
        })
      }

      // Update Master Codes
      const { data: masterCodes } = await supabase
        .from('qr_master_codes')
        .select('id')
        .eq('batch_id', batch.id)
        .eq('status', 'printed')
        .limit(CHUNK_SIZE)

      let masterUpdated = 0
      if (masterCodes && masterCodes.length > 0) {
        const masterIds = masterCodes.map(m => m.id)
        const { error: masterError } = await supabase
          .from('qr_master_codes')
          .update({ status: 'ready_to_ship' })
          .in('id', masterIds)
        
        if (masterError) {
            console.error('Error updating master codes:', JSON.stringify(masterError, null, 2))
            // Don't fail the whole job, just retry next time? 
            // Or maybe mark as failed? For now, let's break and retry next run.
            break; 
        }
        masterUpdated = masterIds.length
      }

      // Update Unique Codes
      // Only if we didn't fill the chunk with master codes? 
      // Or do we want to do both in parallel?
      // Let's do them sequentially.
      
      const { data: uniqueCodes } = await supabase
        .from('qr_codes')
        .select('id')
        .eq('batch_id', batch.id)
        .eq('status', 'printed')
        .limit(CHUNK_SIZE)

      let uniqueUpdated = 0
      if (uniqueCodes && uniqueCodes.length > 0) {
        const uniqueIds = uniqueCodes.map(u => u.id)
        const { error: uniqueError } = await supabase
          .from('qr_codes')
          .update({ status: 'ready_to_ship' })
          .in('id', uniqueIds)
        
        if (uniqueError) {
            console.error('Error updating unique codes:', uniqueError)
            break;
        }
        uniqueUpdated = uniqueIds.length
      }

      processedCount += masterUpdated + uniqueUpdated

      if (masterUpdated === 0 && uniqueUpdated === 0) {
        hasMore = false
      }
    }

    // 4. If done, mark as completed
    if (!hasMore) {
      await supabase
        .from('qr_batches')
        .update({ packing_status: 'completed' })
        .eq('id', batch.id)
      
      console.log(`✅ Batch ${batch.id} packing completed`)
      return NextResponse.json({ message: 'Batch packing completed', processed: processedCount })
    }

    return NextResponse.json({ message: 'Batch packing in progress', processed: processedCount })

  } catch (error) {
    console.error('Worker error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
