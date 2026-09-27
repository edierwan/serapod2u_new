import { guardUserOperation } from '@/lib/security-access/operation'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user: saUser } } = await supabase.auth.getUser()
  if (!saUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const saDenied = await guardUserOperation(saUser.id, 'manufacturing.production.manage')
  if (saDenied) return saDenied
  const { batch_id, limit = 1000 } = await request.json()

  if (!batch_id) {
    return NextResponse.json({ error: 'Batch ID is required' }, { status: 400 })
  }

  // Update Master Codes
  // We update a chunk of master codes
  const { data: masterCodes, error: masterFetchError } = await supabase
    .from('qr_master_codes')
    .select('id')
    .eq('batch_id', batch_id)
    .eq('status', 'printed')
    .limit(limit)

  let masterUpdatedCount = 0
  if (masterCodes && masterCodes.length > 0) {
    const masterIds = masterCodes.map(m => m.id)
    const { error: masterUpdateError } = await supabase
      .from('qr_master_codes')
      .update({ status: 'packed' })
      .in('id', masterIds)
    
    if (masterUpdateError) {
        return NextResponse.json({ error: masterUpdateError.message }, { status: 500 })
    }
    masterUpdatedCount = masterIds.length
  }

  // Update Unique Codes
  const { data: uniqueCodes, error: uniqueFetchError } = await supabase
    .from('qr_codes')
    .select('id')
    .eq('batch_id', batch_id)
    .eq('status', 'printed')
    .limit(limit)

  let uniqueUpdatedCount = 0
  if (uniqueCodes && uniqueCodes.length > 0) {
    const uniqueIds = uniqueCodes.map(u => u.id)
    const { error: uniqueUpdateError } = await supabase
      .from('qr_codes')
      .update({ status: 'packed' })
      .in('id', uniqueIds)
    
    if (uniqueUpdateError) {
        return NextResponse.json({ error: uniqueUpdateError.message }, { status: 500 })
    }
    uniqueUpdatedCount = uniqueIds.length
  }

  return NextResponse.json({
    masterUpdated: masterUpdatedCount,
    uniqueUpdated: uniqueUpdatedCount,
    hasMore: masterUpdatedCount > 0 || uniqueUpdatedCount > 0
  })
}
