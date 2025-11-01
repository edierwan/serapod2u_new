import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    
    // Get all master codes with warehouse_received_at set
    const { data: allReceived, error } = await supabase
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
            order_no,
            warehouse_org_id
          )
        )
      `)
      .not('warehouse_received_at', 'is', null)
      .order('warehouse_received_at', { ascending: false })
      .limit(20)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get current user info
    const { data: { user } } = await supabase.auth.getUser()
    
    let userInfo = null
    if (user) {
      const { data: profile } = await supabase
        .from('users')
        .select('id, email, organization_id, full_name')
        .eq('id', user.id)
        .single()
      userInfo = profile
    }

    return NextResponse.json({
      message: 'Warehouse Intake Diagnostic Report',
      current_user: userInfo,
      total_received_cases: allReceived?.length || 0,
      received_master_codes: allReceived?.map(r => {
        const batch = Array.isArray(r.qr_batches) ? r.qr_batches[0] : r.qr_batches
        const order = batch?.orders
        const orderRecord = Array.isArray(order) ? order[0] : order
        
        return {
          master_code: r.master_code,
          status: r.status,
          warehouse_org_id_on_master: r.warehouse_org_id,
          warehouse_org_id_on_order: orderRecord?.warehouse_org_id,
          warehouse_received_at: r.warehouse_received_at,
          order_no: orderRecord?.order_no,
          matches_your_org: userInfo ? r.warehouse_org_id === userInfo.organization_id : null
        }
      })
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    })
  } catch (error: any) {
    console.error('Simple check error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
