import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get organization_id from users profile table
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (!profile.organization_id) {
      return NextResponse.json({ error: 'Organization not assigned' }, { status: 400 })
    }

    console.log('🔍 Querying shipment history for warehouse org:', profile.organization_id)

    // Query qr_validation_reports to get shipment sessions
    // Show BOTH approved (completed) and pending/matched (current scanning) sessions
    const { data: sessions, error: sessionError } = await supabase
      .from('qr_validation_reports')
      .select(`
        id,
        warehouse_org_id,
        distributor_org_id,
        destination_order_id,
        validation_status,
        master_codes_scanned,
        unique_codes_scanned,
        scanned_quantities,
        created_at,
        updated_at,
        approved_at,
        destination_order:orders!qr_validation_reports_destination_order_id_fkey (
          id,
          order_no
        ),
        distributor:organizations!qr_validation_reports_distributor_org_id_fkey (
          id,
          org_name
        )
      `)
      .eq('warehouse_org_id', profile.organization_id)
      .in('validation_status', ['approved', 'pending', 'matched'])  // Show approved (shipped) AND current scanning sessions
      .order('updated_at', { ascending: false })  // Most recent first
      .limit(20)  // Show more to include both current and recent history

    if (sessionError) {
      console.error('❌ Sessions query error:', sessionError)
      return NextResponse.json({ error: 'Database query failed', details: sessionError.message }, { status: 500 })
    }

    console.log('📦 Found sessions:', sessions?.length || 0)

    if (!sessions || sessions.length === 0) {
      console.log('ℹ️ No shipment sessions found for this warehouse')
      return NextResponse.json({
        success: true,
        count: 0,
        history: []
      })
    }

    // Collect all scanned codes from sessions
    const allMasterCodes = new Set<string>()
    const allUniqueCodes = new Set<string>()
    
    sessions.forEach(session => {
      const masters = session.master_codes_scanned || []
      const uniques = session.unique_codes_scanned || []
      masters.forEach((mc: string) => allMasterCodes.add(mc))
      uniques.forEach((uc: string) => allUniqueCodes.add(uc))
    })

    console.log('🔢 Total codes: master=', allMasterCodes.size, 'unique=', allUniqueCodes.size)

    // Query all codes to get product information
    let qrCodes: any[] = []
    
    if (allUniqueCodes.size > 0 || allMasterCodes.size > 0) {
      const uniqueCodesArray = Array.from(allUniqueCodes)
      const masterCodesArray = Array.from(allMasterCodes)
      
      // Build query based on what codes we have
      let query = supabase
        .from('qr_codes')
        .select(`
          code,
          master_code_id,
          variant_id,
          product_variants (
            variant_name,
            products (
              product_name
            )
          ),
          qr_master_codes (
            master_code,
            case_number
          )
        `)
        .limit(500)

      // Add filters for unique codes
      if (uniqueCodesArray.length > 0) {
        query = query.in('code', uniqueCodesArray.slice(0, 100)) // Limit to avoid URL length issues
      }

      const { data: qrData, error: qrError } = await query

      if (qrError) {
        console.warn('⚠️ QR codes query warning:', qrError)
      } else {
        qrCodes = qrData || []
      }
    }

    console.log('🏷️ Found QR codes for product info:', qrCodes?.length || 0)

    // Create a map of code -> product info
    const codeProductMap = new Map<string, any>()
    ;(qrCodes || []).forEach(qr => {
      const variant = Array.isArray(qr.product_variants) ? qr.product_variants[0] : qr.product_variants
      const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
      const master = Array.isArray(qr.qr_master_codes) ? qr.qr_master_codes[0] : qr.qr_master_codes
      
      if (product && variant) {
        codeProductMap.set(qr.code, {
          product_name: product.product_name,
          variant_name: variant.variant_name,
          master_code: master?.master_code || null,
          case_number: master?.case_number || null
        })
      }
    })

    console.log('📍 Product info mapped for', codeProductMap.size, 'codes')

    // Format response - one entry per session (shipment)
    const history: any[] = []
    
    for (const session of sessions) {
      const order = Array.isArray(session.destination_order) ? session.destination_order[0] : session.destination_order
      const distributor = Array.isArray(session.distributor) ? session.distributor[0] : session.distributor
      
      const orderNo = order?.order_no || 'Unknown'
      const distributorName = distributor?.org_name || 'Unknown'
      
      // Get master and unique codes for this session
      const masterCodes = session.master_codes_scanned || []
      const uniqueCodes = session.unique_codes_scanned || []
      const allCodes = [...masterCodes, ...uniqueCodes]
      
      // Aggregate products across all codes in this session
      const productBreakdown: Record<string, number> = {}
      let totalUnits = 0
      let caseNumber = 0
      let masterCode = ''
      
      allCodes.forEach((code: string) => {
        const productInfo = codeProductMap.get(code)
        if (productInfo) {
          const key = `${productInfo.product_name} - ${productInfo.variant_name}`
          productBreakdown[key] = (productBreakdown[key] || 0) + 1
          totalUnits++
          
          if (productInfo.case_number && !caseNumber) {
            caseNumber = productInfo.case_number
          }
          if (productInfo.master_code && !masterCode) {
            masterCode = productInfo.master_code
          }
        }
      })

      // ⚠️ Use ACTUAL code count, not cumulative scanned_quantities
      // The scanned_quantities can be cumulative across multiple scans
      // We want the ACTUAL codes that were shipped in THIS session
      const actualUnits = masterCodes.length + uniqueCodes.length
      
      // Determine actual status by checking if ANY codes in this session are shipped
      // Query the actual QR code statuses to get the real state
      let actualStatus = 'warehouse_packed'  // Default
      if (allCodes.length > 0) {
        // Sample a few codes to check their actual status
        const samplCodes = allCodes.slice(0, 5)
        const { data: statusCheck } = await supabase
          .from('qr_codes')
          .select('status')
          .in('code', samplCodes)
          .limit(1)
          .maybeSingle()
        
        if (statusCheck?.status === 'shipped_distributor') {
          actualStatus = 'shipped_distributor'
        } else {
          // Also check master codes
          const { data: masterStatusCheck } = await supabase
            .from('qr_master_codes')
            .select('status')
            .in('master_code', masterCodes.slice(0, 5))
            .limit(1)
            .maybeSingle()
          
          if (masterStatusCheck?.status === 'shipped_distributor') {
            actualStatus = 'shipped_distributor'
          }
        }
      }
      
      history.push({
        id: session.id,
        master_code: masterCode || `SESSION-${session.id.substring(0, 8)}`,
        case_number: caseNumber || masterCodes.length,
        actual_unit_count: actualUnits,  // Count of codes in THIS session only
        scanned_at: session.approved_at || session.updated_at || session.created_at,
        order_id: session.destination_order_id,
        order_no: orderNo,
        distributor_id: session.distributor_org_id,
        distributor_name: distributorName,
        status: actualStatus,  // Use actual QR code status, not session status
        validation_status: session.validation_status,  // Keep original for UI logic
        product_breakdown: productBreakdown
      })
    }

    console.log('✅ Formatted history:', history.length, 'sessions')

    // NEW: Also fetch warehouse_packed codes that haven't been shipped yet
    console.log('🔍 Fetching unshipped warehouse_packed codes...')
    
    const { data: unshippedMasters, error: unshippedError } = await supabase
      .from('qr_master_codes')
      .select(`
        id,
        master_code,
        case_number,
        status,
        actual_unit_count,
        expected_unit_count,
        created_at,
        shipped_to_distributor_id,
        shipped_to_distributor:organizations!qr_master_codes_shipped_to_distributor_id_fkey (
          id,
          org_name
        ),
        qr_batches (
          order_id,
          orders (
            id,
            order_no,
            buyer_org_id,
            seller_org_id,
            buyer:organizations!orders_buyer_org_id_fkey (
              id,
              org_name
            ),
            seller:organizations!orders_seller_org_id_fkey (
              id,
              org_name
            )
          )
        )
      `)
      .eq('status', 'warehouse_packed')
      .order('created_at', { ascending: false })
      .limit(50)

    if (unshippedError) {
      console.warn('⚠️ Warning fetching unshipped codes:', unshippedError)
    } else if (unshippedMasters && unshippedMasters.length > 0) {
      console.log(`📦 Found ${unshippedMasters.length} unshipped warehouse_packed master codes`)
      
      // Get child codes count for each master

      const masterIds = unshippedMasters.map(m => m.id)

      const { data: unshippedCodes, error: unshippedCodesError } = await supabase
        .from('qr_codes')
        .select(`
          code,
          master_code_id,
          product_variants (
            variant_name,
            products (
              product_name
            )
          )
        `)
        .in('master_code_id', masterIds)
        .eq('status', 'warehouse_packed')
        .limit(5000)

      if (unshippedCodesError) {
        console.warn('⚠️ Warning fetching unshipped child codes:', unshippedCodesError)
      }

      const childCountMap = new Map<string, number>()
      const productBreakdownMap = new Map<string, Record<string, number>>()
      const uniqueDetailsMap = new Map<string, Array<{ code: string, product_name: string, variant_name: string }>>()

      ;(unshippedCodes || []).forEach(code => {
        if (!code.master_code_id) return

        const variant = Array.isArray(code.product_variants) ? code.product_variants[0] : code.product_variants
        const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null

        const productLabel = product?.product_name
          ? `${product.product_name}${variant?.variant_name ? ` - ${variant.variant_name}` : ''}`
          : 'Uncategorized Product'

        if (!productBreakdownMap.has(code.master_code_id)) {
          productBreakdownMap.set(code.master_code_id, {})
        }

        if (!uniqueDetailsMap.has(code.master_code_id)) {
          uniqueDetailsMap.set(code.master_code_id, [])
        }

        const breakdown = productBreakdownMap.get(code.master_code_id)!
        breakdown[productLabel] = (breakdown[productLabel] || 0) + 1

        uniqueDetailsMap.get(code.master_code_id)!.push({
          code: code.code,
          product_name: product?.product_name || 'Unknown Product',
          variant_name: variant?.variant_name || 'Unit'
        })

        childCountMap.set(code.master_code_id, (childCountMap.get(code.master_code_id) || 0) + 1)
      })

      // Add unshipped masters to history
      unshippedMasters.forEach((master: any) => {
        const batch = Array.isArray(master.qr_batches) ? master.qr_batches[0] : master.qr_batches
        const order = batch?.orders ? (Array.isArray(batch.orders) ? batch.orders[0] : batch.orders) : null
        const buyer = order?.buyer ? (Array.isArray(order.buyer) ? order.buyer[0] : order.buyer) : null
        const seller = order?.seller ? (Array.isArray(order.seller) ? order.seller[0] : order.seller) : null
        const shippedDistributor = master?.shipped_to_distributor ? (Array.isArray(master.shipped_to_distributor) ? master.shipped_to_distributor[0] : master.shipped_to_distributor) : null
        
        const childCount = childCountMap.get(master.id) || master.actual_unit_count || master.expected_unit_count || 0
        const breakdown = productBreakdownMap.get(master.id) || (childCount > 0
          ? { [master.master_code]: childCount }
          : {})

        const distributorId = master.shipped_to_distributor_id || order?.buyer_org_id || order?.seller_org_id || null
        let distributorName = 'Unknown'
        if (master.shipped_to_distributor_id && shippedDistributor?.org_name) {
          distributorName = shippedDistributor.org_name
        } else if (order?.buyer_org_id && buyer?.org_name) {
          distributorName = buyer.org_name
        } else if (seller?.org_name) {
          distributorName = seller.org_name
        }

        const uniqueDetails = uniqueDetailsMap.get(master.id) || []

        const existingEntry = history.find(item => item.master_code === master.master_code && item.status === 'warehouse_packed')

        if (existingEntry) {
          existingEntry.actual_unit_count = childCount
          existingEntry.order_id = existingEntry.order_id || order?.id || null
          existingEntry.order_no = order?.order_no || existingEntry.order_no || 'Unknown'
          existingEntry.distributor_id = distributorId || existingEntry.distributor_id || ''
          existingEntry.distributor_name = distributorName || existingEntry.distributor_name || 'Unknown'

          if (Object.keys(breakdown).length > 0) {
            existingEntry.product_breakdown = breakdown
          }

          existingEntry.pending_master_codes = Array.from(new Set([...(existingEntry.pending_master_codes || []), master.master_code]))
          existingEntry.pending_unique_codes = [
            ...(existingEntry.pending_unique_codes || []),
            ...uniqueDetails
          ]
        } else {
          history.push({
            id: `unshipped-${master.id}`,
            master_code: master.master_code,
            case_number: master.case_number,
            actual_unit_count: childCount,
            scanned_at: master.created_at,
            order_id: order?.id || null,
            order_no: order?.order_no || 'Unknown',
            distributor_id: distributorId || null,
            distributor_name: distributorName,
            status: 'warehouse_packed',  // Show as warehouse_packed (not yet shipped)
            validation_status: null,  // No session yet
            product_breakdown: breakdown,
            pending_master_codes: [master.master_code],
            pending_unique_codes: uniqueDetails
          })
        }
      })
      
      console.log(`✅ Total history (sessions + unshipped): ${history.length} records`)
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
