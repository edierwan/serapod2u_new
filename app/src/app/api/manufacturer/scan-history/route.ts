import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    console.log('[Scan History API] User authenticated:', user?.email)
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get organization_id from users profile table
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    console.log('[Scan History API] Organization:', profile?.organization_id)

    if (profileError || !profile) {
      console.error('[Scan History API] Profile lookup failed:', profileError)
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (!profile.organization_id) {
      console.warn('[Scan History API] User missing organization assignment')
      return NextResponse.json({ error: 'Organization not assigned' }, { status: 400 })
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const orderIdFilter = searchParams.get('order_id')
    
    console.log('[Scan History API] Filter by order_id:', orderIdFilter || 'none')

    // Query qr_master_codes table with proper joins
    // Include 'generated', 'packed', and 'ready_to_ship' statuses to show all manufacturer scans
    let query = supabase
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
          orders!inner (
            id,
            order_no
          )
        )
      `)
      .eq('manufacturer_org_id', profile.organization_id)
      .in('status', ['generated', 'packed', 'ready_to_ship', 'received_warehouse', 'shipped_distributor', 'opened'])
      .not('manufacturer_scanned_at', 'is', null)
      .gt('actual_unit_count', 0)
    
    // Apply order_id filter if provided
    if (orderIdFilter) {
      query = query.eq('qr_batches.order_id', orderIdFilter)
    }
    
    const { data: masterCodes, error: queryError } = await query
      .order('manufacturer_scanned_at', { ascending: false })
      .limit(1000) // Increased limit to support large batches (e.g., 150+ cases)

    if (queryError) {
      console.error('[Scan History API] Query error:', queryError)
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 })
    }

    console.log('[Scan History API] Found', masterCodes?.length || 0, 'master codes')

    // Format response
    const history = (masterCodes || []).map((item: any) => {
      const batch = Array.isArray(item.qr_batches) ? item.qr_batches[0] : item.qr_batches
      const order = batch?.orders ? (Array.isArray(batch.orders) ? batch.orders[0] : batch.orders) : null
      
      // Extract order_id correctly - this is the UUID from orders.id
      const orderId = order?.id || batch?.order_id || null
      const orderNo = order?.order_no || 'N/A'
      
      // Generate batch code from order number
      const batchCode = orderNo && orderNo !== 'N/A'
        ? `BATCH-${orderNo}` 
        : item.batch_id 
          ? `BATCH-${item.batch_id.substring(0, 8).toUpperCase()}`
          : 'UNKNOWN'

      console.log(`[Scan History API] Mapping record:`, {
        master_code_id: item.id,
        case_number: item.case_number,
        order_id: orderId,
        order_no: orderNo,
        batch_id: item.batch_id
      })

      return {
        id: item.id, // This is qr_master_codes.id (needed for unlink)
        master_code_id: item.id, // Explicitly include for unlink functionality
        master_code: item.master_code,
        case_number: item.case_number,
        actual_unit_count: item.actual_unit_count,
        scanned_at: item.manufacturer_scanned_at,
        batch_code: batchCode,
        batch_id: item.batch_id,
        order_id: orderId, // This is orders.id UUID
        order_no: orderNo,
        status: item.status
      }
    })

    console.log('[Scan History API] Returning', history.length, 'records')
    if (history.length > 0) {
      console.log('[Scan History API] Sample record:', {
        master_code_id: history[0].master_code_id,
        order_id: history[0].order_id,
        order_no: history[0].order_no,
        case_number: history[0].case_number
      })
    }

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
