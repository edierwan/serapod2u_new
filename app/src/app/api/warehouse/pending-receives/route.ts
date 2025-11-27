import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError) {
      console.error('❌ Auth error in pending-receives:', authError)
      return NextResponse.json({ error: 'Authentication failed', details: authError.message }, { status: 401 })
    }
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized - no user session' }, { status: 401 })
    }

    // Check if user is Super Admin (role_level = 1)
    const { data: profile } = await supabase
      .from('users')
      .select('role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    const isSuperAdmin = profile && (profile as any).roles && (profile as any).roles.role_level === 1

    // Get warehouse_org_id from query params
    const searchParams = request.nextUrl.searchParams
    const warehouse_org_id = searchParams.get('warehouse_org_id')

    // Super Admin can view ALL warehouses if no warehouse_org_id is provided
    if (!warehouse_org_id && !isSuperAdmin) {
      return NextResponse.json({ error: 'warehouse_org_id is required' }, { status: 400 })
    }

    console.log('🔍 Fetching pending receives for warehouse_org_id:', warehouse_org_id || 'ALL (Super Admin)')

    let pendingBatches: any[] | null = null
    let queryError: any = null

    if (warehouse_org_id) {
      // Execute SECURITY DEFINER RPC to bypass RLS while enforcing warehouse filters server-side
      const result = await supabase
        .rpc('get_pending_receives_for_warehouse', {
          p_warehouse_org_id: warehouse_org_id
        })
      pendingBatches = result.data
      queryError = result.error
    } else if (isSuperAdmin) {
      // Super Admin: Query only ready_to_ship orders across all warehouses
      // Only show orders that are ready for warehouse receiving (not still in 'packed' status)
      const result = await supabase
        .from('qr_master_codes')
        .select(`
          id,
          master_code,
          case_number,
          actual_unit_count,
          expected_unit_count,
          status,
          manufacturer_scanned_at,
          warehouse_org_id,
          manufacturer_org_id,
          warehouse_received_at,
          qr_batches!inner (
            id,
            company_id,
            order_id,
            orders (
              order_no,
              buyer_org_id,
              seller_org_id,
              buyer:organizations!orders_buyer_org_id_fkey (
                org_name
              )
            )
          )
        `)
        .eq('status', 'ready_to_ship')
        .is('warehouse_received_at', null)
        .order('manufacturer_scanned_at', { ascending: false })

      if (result.data) {
        // Transform to match RPC output format
        pendingBatches = result.data.map((item: any) => {
          const batch = Array.isArray(item.qr_batches) ? item.qr_batches[0] : item.qr_batches
          const order = batch?.orders ? (Array.isArray(batch.orders) ? batch.orders[0] : batch.orders) : null
          const buyer = order?.buyer ? (Array.isArray(order.buyer) ? order.buyer[0] : order.buyer) : null

          return {
            master_id: item.id,
            master_code: item.master_code,
            case_number: item.case_number,
            actual_unit_count: item.actual_unit_count,
            expected_unit_count: item.expected_unit_count,
            status: item.status,
            manufacturer_scanned_at: item.manufacturer_scanned_at,
            warehouse_org_id: item.warehouse_org_id,
            manufacturer_org_id: item.manufacturer_org_id,
            batch_id: batch?.id || null,
            company_id: batch?.company_id || null,
            order_id: batch?.order_id || null,
            order_no: order?.order_no || null,
            buyer_org_id: order?.buyer_org_id || null,
            buyer_org_name: buyer?.org_name || null,
            seller_org_id: order?.seller_org_id || null
          }
        })
      }
      queryError = result.error
    }

    if (queryError) {
      console.error('❌ Error fetching pending batches:', queryError)
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
    
    // Ensure we always return valid JSON
    const errorMessage = error?.message || String(error) || 'Failed to load pending receives'
    const errorDetails = {
      error: errorMessage,
      timestamp: new Date().toISOString(),
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
    }
    
    return NextResponse.json(errorDetails, { status: 500 })
  }
}
