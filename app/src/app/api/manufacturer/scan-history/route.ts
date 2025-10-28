import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    console.log('User authenticated:', user?.email)
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get organization_id from users profile table
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    console.log('Organization:', profile?.organization_id)

    if (profileError || !profile) {
      console.error('Profile lookup failed:', profileError)
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (!profile.organization_id) {
      console.warn('User missing organization assignment')
      return NextResponse.json({ error: 'Organization not assigned' }, { status: 400 })
    }

    // Query qr_master_codes table
    // Include 'generated' status to show partially filled master cases
    const { data: masterCodes, error: queryError } = await supabase
      .from('qr_master_codes')
      .select(`
        id,
        master_code,
        case_number,
        actual_unit_count,
        manufacturer_scanned_at,
        batch_id,
        status,
        qr_batches!inner (
          id,
          order_id,
          orders (
            id,
            order_no
          )
        )
      `)
      .eq('manufacturer_org_id', profile.organization_id)
      .in('status', ['generated', 'packed', 'received_warehouse', 'shipped_distributor', 'opened'])
      .not('manufacturer_scanned_at', 'is', null)
      .gt('actual_unit_count', 0)
      .order('manufacturer_scanned_at', { ascending: false })
      .limit(50)

    if (queryError) {
      console.error('Query error:', queryError)
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
    }

    console.log('Found', masterCodes?.length || 0, 'master codes')

    // Format response
    const history = (masterCodes || []).map((item: any) => {
      const batch = Array.isArray(item.qr_batches) ? item.qr_batches[0] : item.qr_batches
  const order = batch?.orders ? (Array.isArray(batch.orders) ? batch.orders[0] : batch.orders) : null
  const orderId = order?.id || batch?.order_id || null
  const orderNo = order?.order_no || 'N/A'
      
      // Generate batch code from order number
      const batchCode = orderNo && orderNo !== 'N/A'
        ? `BATCH-${orderNo}` 
        : item.batch_id 
          ? `BATCH-${item.batch_id.substring(0, 8).toUpperCase()}`
          : 'UNKNOWN'

      return {
        id: item.id,
        master_code: item.master_code,
        case_number: item.case_number,
        actual_unit_count: item.actual_unit_count,
        scanned_at: item.manufacturer_scanned_at,
        batch_code: batchCode,
  order_id: orderId,
  order_no: orderNo,
        status: item.status
      }
    })

    return NextResponse.json({
      success: true,
      count: history.length,
      history: history
    })
  } catch (error: any) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}
