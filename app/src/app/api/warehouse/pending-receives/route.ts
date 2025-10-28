import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get warehouse_org_id from query params
    const searchParams = request.nextUrl.searchParams
    const warehouse_org_id = searchParams.get('warehouse_org_id')

    if (!warehouse_org_id) {
      return NextResponse.json({ error: 'warehouse_org_id is required' }, { status: 400 })
    }

    console.log('🔍 Fetching pending receives for warehouse_org_id:', warehouse_org_id)

    // Execute SECURITY DEFINER RPC to bypass RLS while enforcing warehouse filters server-side
    const { data: pendingBatches, error: queryError } = await supabase
      .rpc('get_pending_receives_for_warehouse', {
        p_warehouse_org_id: warehouse_org_id
      })

    if (queryError) {
      console.error('❌ Error fetching pending batches via RPC:', queryError)
      return NextResponse.json({ error: queryError.message }, { status: 500 })
    }

    const summaryByOrder = new Map<string, { readyCases: number; lastScan?: string | null }>()
    ;(pendingBatches || []).forEach((item: any) => {
      const orderId = item.order_id
      if (!orderId) return
      if (!summaryByOrder.has(orderId)) {
        summaryByOrder.set(orderId, {
          readyCases: 0,
          lastScan: item.manufacturer_scanned_at || null
        })
      }
      const record = summaryByOrder.get(orderId)!
      record.readyCases += 1
      if (!record.lastScan || (item.manufacturer_scanned_at && item.manufacturer_scanned_at > record.lastScan)) {
        record.lastScan = item.manufacturer_scanned_at
      }
    })

    console.info('📊 Pending batches summary', {
      warehouse_org_id,
      totalMasters: pendingBatches?.length || 0,
      orders: Array.from(summaryByOrder.entries()).map(([orderId, stats]) => ({
        orderId,
        readyCases: stats.readyCases,
        lastScan: stats.lastScan
      }))
    })

    // Transform the data for the frontend
    const transformedBatches = (pendingBatches || []).map((item: any) => ({
      id: item.master_id,
      master_code: item.master_code,
      case_number: item.case_number,
      actual_unit_count: item.actual_unit_count,
      expected_unit_count: item.expected_unit_count,
      status: item.status,
      manufacturer_scanned_at: item.manufacturer_scanned_at,
      batch_id: item.batch_id,
      order_id: item.order_id,
      order_no: item.order_no || null,
      buyer_org_id: item.buyer_org_id,
      buyer_org_name: item.buyer_org_name,
      seller_org_id: item.seller_org_id,
      warehouse_org_id: item.warehouse_org_id,
      company_id: item.company_id
    }))

    // Log sample to verify order_no is included
    if (transformedBatches.length > 0) {
      console.log('📦 Sample transformed batch:', {
        order_id: transformedBatches[0].order_id,
        order_no: transformedBatches[0].order_no,
        master_code: transformedBatches[0].master_code
      })
    }

    return NextResponse.json(transformedBatches)
  } catch (error: any) {
    console.error('❌ Pending receives error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to load pending receives' },
      { status: 500 }
    )
  }
}
