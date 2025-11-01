import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// TEMPORARY TEST ENDPOINT - Remove after debugging
export async function GET() {
  const supabase = await createClient()
  const warehouseOrgId = 'dc711574-65ac-4137-a931-69df4ec73dc6'
  const startIso = '2015-11-01T00:00:00.000Z'
  const endIso = '2025-11-01T23:59:59.999Z'

  const { data, error } = await supabase
    .from('qr_master_codes')
    .select(`
      id,
      master_code,
      warehouse_received_at,
      warehouse_org_id,
      actual_unit_count,
      expected_unit_count,
      qr_batches!inner (
        order_id,
        orders!inner (
          id,
          order_no,
          buyer_org_id,
          organizations!orders_buyer_org_id_fkey (
            org_name
          )
        )
      )
    `)
    .eq('warehouse_org_id', warehouseOrgId)
    .not('warehouse_received_at', 'is', null)
    .gte('warehouse_received_at', startIso)
    .lte('warehouse_received_at', endIso)
    .order('warehouse_received_at', { ascending: false })
    .limit(2000)

  return NextResponse.json({
    test: 'intake history raw query',
    warehouseOrgId,
    dateRange: { start: startIso, end: endIso },
    error: error?.message,
    recordCount: data?.length || 0,
    rawData: data
  })
}
