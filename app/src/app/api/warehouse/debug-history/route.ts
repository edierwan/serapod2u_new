import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user profile to find warehouse org id
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select(`
        *,
        organizations:organization_id (
          id,
          org_name,
          org_type_code
        )
      `)
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      console.error('❌ Failed to load user profile:', profileError)
      return NextResponse.json({ 
        error: 'User profile not found',
        details: profileError?.message,
        user_id: user.id 
      }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const warehouseOrgId = searchParams.get('warehouse_org_id') || userProfile.organization_id

    if (!warehouseOrgId) {
      return NextResponse.json({ error: 'warehouse_org_id could not be determined' }, { status: 400 })
    }

    // Query 1: Count ALL master codes with warehouse_received_at set
    const { count: totalWithTimestamp, error: countError1 } = await supabase
      .from('qr_master_codes')
      .select('*', { count: 'exact', head: true })
      .not('warehouse_received_at', 'is', null)

    // Query 2: Count master codes with warehouse_received_at for THIS warehouse
    const { count: totalForWarehouse, error: countError2 } = await supabase
      .from('qr_master_codes')
      .select('*', { count: 'exact', head: true })
      .eq('warehouse_org_id', warehouseOrgId)
      .not('warehouse_received_at', 'is', null)

    // Query 3: Get sample records for THIS warehouse (last 10)
    const { data: sampleRecords, error: sampleError } = await supabase
      .from('qr_master_codes')
      .select(`
        id,
        master_code,
        status,
        warehouse_org_id,
        warehouse_received_at,
        created_at
      `)
      .eq('warehouse_org_id', warehouseOrgId)
      .not('warehouse_received_at', 'is', null)
      .order('warehouse_received_at', { ascending: false })
      .limit(10)

    // Query 4: Get ALL master codes for this warehouse (any status)
    const { count: totalMasterCodesForWarehouse, error: countError3 } = await supabase
      .from('qr_master_codes')
      .select('*', { count: 'exact', head: true })
      .eq('warehouse_org_id', warehouseOrgId)

    // Query 5: Count by status for this warehouse
    const { data: statusBreakdown, error: statusError } = await supabase
      .from('qr_master_codes')
      .select('status')
      .eq('warehouse_org_id', warehouseOrgId)

    const statusCounts: Record<string, number> = {}
    ;(statusBreakdown || []).forEach((row: any) => {
      const status = row.status || 'null'
      statusCounts[status] = (statusCounts[status] || 0) + 1
    })

    // Query 6: Get ALL master codes with warehouse_received_at (globally) to see what warehouses they belong to
    const { data: globalReceived, error: globalError } = await supabase
      .from('qr_master_codes')
      .select(`
        id,
        master_code,
        status,
        warehouse_org_id,
        warehouse_received_at,
        qr_batches!inner (
          order_id,
          orders!inner (
            order_no
          )
        )
      `)
      .not('warehouse_received_at', 'is', null)
      .order('warehouse_received_at', { ascending: false })
      .limit(10)

    return NextResponse.json({
      debug_info: {
        user_id: user.id,
        user_email: user.email,
        user_organization: userProfile.organizations,
        warehouse_org_id: warehouseOrgId,
        queries: {
          total_with_warehouse_received_at_globally: {
            count: totalWithTimestamp,
            error: countError1?.message
          },
          total_with_warehouse_received_at_for_this_warehouse: {
            count: totalForWarehouse,
            error: countError2?.message
          },
          total_master_codes_for_this_warehouse_any_status: {
            count: totalMasterCodesForWarehouse,
            error: countError3?.message
          },
          status_breakdown_for_this_warehouse: {
            counts: statusCounts,
            error: statusError?.message
          }
        },
        sample_received_records: {
          count: sampleRecords?.length || 0,
          records: sampleRecords?.map(r => ({
            master_code: r.master_code,
            status: r.status,
            warehouse_received_at: r.warehouse_received_at,
            created_at: r.created_at
          })),
          error: sampleError?.message
        },
        global_received_records: {
          count: globalReceived?.length || 0,
          records: globalReceived?.map(r => {
            const batch = Array.isArray(r.qr_batches) ? r.qr_batches[0] : r.qr_batches
            const order = batch?.orders
            const orderRecord = Array.isArray(order) ? order[0] : order
            return {
              master_code: r.master_code,
              status: r.status,
              warehouse_org_id: r.warehouse_org_id,
              warehouse_received_at: r.warehouse_received_at,
              order_no: orderRecord?.order_no,
              matches_your_warehouse: r.warehouse_org_id === warehouseOrgId
            }
          }),
          error: globalError?.message,
          explanation: 'These are ALL master codes with warehouse_received_at set in the entire database'
        }
      }
    })
  } catch (error: any) {
    console.error('❌ Debug history error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch debug info' },
      { status: 500 }
    )
  }
}
