import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * Debug endpoint that simulates the warehouse receiving worker step by step.
 * Returns diagnostic info at each step to find where the worker fails.
 * Usage: GET /api/warehouse/debug-worker?batchId=xxx
 */
export async function GET(request: NextRequest) {
  const batchId = request.nextUrl.searchParams.get('batchId')
  if (!batchId) {
    return NextResponse.json({ error: 'batchId required' }, { status: 400 })
  }

  const supabase = createAdminClient(120_000)
  const steps: { step: string; result?: any; error?: any; ms: number }[] = []

  async function trace<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    const t = Date.now()
    try {
      const result = await fn()
      steps.push({ step: name, result: JSON.stringify(result)?.substring(0, 500), ms: Date.now() - t })
      return result
    } catch (e: any) {
      steps.push({ step: name, error: e.message || String(e), ms: Date.now() - t })
      return null
    }
  }

  // Step 1: Fetch batch
  const batch = await trace('fetch_batch', async () => {
    const { data, error } = await supabase
      .from('qr_batches')
      .select(`
        id, receiving_status, receiving_progress, created_by, last_error, order_id, total_unique_codes,
        orders (id, order_no, buyer_org_id, seller_org_id, company_id, order_items (variant_id, unit_price))
      `)
      .eq('id', batchId)
      .single()
    return { data, error }
  })

  if (!batch?.data) {
    return NextResponse.json({ steps, error: 'Batch not found' })
  }

  const order = (batch.data as any).orders

  // Step 2: resolveWarehouseOrgId
  const buyerOrgId = order?.buyer_org_id
  await trace('resolve_warehouse_org', async () => {
    const { data: buyerOrg, error: e1 } = await supabase
      .from('organizations')
      .select('org_type_code')
      .eq('id', buyerOrgId)
      .single()
    
    if (buyerOrg?.org_type_code === 'HQ') {
      const { data: whOrg, error: e2 } = await supabase
        .from('organizations')
        .select('id')
        .eq('parent_org_id', buyerOrgId)
        .eq('org_type_code', 'WH')
        .eq('is_active', true)
        .limit(1)
        .single()
      return { buyerOrg, whOrg, e1, e2, resolved: whOrg?.id || buyerOrgId }
    }
    return { buyerOrg, e1, resolved: buyerOrgId }
  })

  // Step 3: Get manufacturer warranty bonus
  const manufacturerOrgId = order?.seller_org_id
  await trace('get_warranty_bonus', async () => {
    const { data: mfgOrg, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', manufacturerOrgId)
      .single()
    return { warranty_bonus: (mfgOrg as any)?.warranty_bonus, error }
  })

  // Step 4: Count already-received codes
  await trace('count_received', async () => {
    const { count, error } = await supabase
      .from('qr_codes')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId)
      .eq('status', 'received_warehouse')
      .eq('is_buffer', false)
    return { count, error }
  })

  // Step 5: Process master codes (check only, don't modify)
  await trace('check_master_codes', async () => {
    const { data, error } = await supabase
      .from('qr_master_codes')
      .select('id, status')
      .eq('batch_id', batchId)
    return { total: data?.length, statuses: data?.reduce((acc: any, m: any) => { acc[m.status] = (acc[m.status] || 0) + 1; return acc }, {}), error }
  })

  // Step 6: Fetch chunk of unique codes
  const chunkResult = await trace('fetch_chunk_500', async () => {
    const { data, error } = await supabase
      .from('qr_codes')
      .select('id, variant_id')
      .eq('batch_id', batchId)
      .eq('status', 'ready_to_ship')
      .eq('is_buffer', false)
      .order('id', { ascending: true })
      .limit(500)
    return { count: data?.length, first_id: data?.[0]?.id, error }
  })

  // Step 7: Try updating 1 code (non-destructive test)
  if (chunkResult && (chunkResult as any).count > 0) {
    const testId = (chunkResult as any).first_id
    await trace('test_update_1_code', async () => {
      // Update 1 code then revert it
      const { error: updateErr } = await supabase
        .from('qr_codes')
        .update({ status: 'received_warehouse' })
        .eq('id', testId)
      
      // Revert it back
      const { error: revertErr } = await supabase
        .from('qr_codes')
        .update({ status: 'ready_to_ship' })
        .eq('id', testId)
      
      return { updateErr, revertErr }
    })
  }

  // Step 8: Test RPC
  await trace('test_rpc_variant_counts', async () => {
    const { data, error } = await (supabase as any).rpc('get_batch_variant_counts', {
      p_batch_id: batchId,
      p_status: 'received_warehouse'
    })
    return { data_length: (data as any[])?.length, error }
  })

  return NextResponse.json({ steps })
}
