import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const distributorId = searchParams.get('distributorId')
    
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get organization_id
    const { data: profile } = await supabase
      .from('users')
      .select('organization_id, role_code, roles(role_level)')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const isSuperAdmin = profile.roles?.role_level === 1
    const warehouseOrgId = profile.organization_id

    // Build query
    let query = supabase
      .from('qr_validation_reports')
      .select(`
        id,
        warehouse_org_id,
        distributor_org_id,
        destination_order_id,
        validation_status,
        scanned_quantities,
        created_at,
        updated_at,
        approved_at,
        destination_order:orders!qr_validation_reports_destination_order_id_fkey (
          id,
          order_no,
          buyer_org_id,
          buyer:organizations!orders_buyer_org_id_fkey (
            id,
            org_name
          )
        ),
        distributor:organizations!qr_validation_reports_distributor_org_id_fkey (
          id,
          org_name
        )
      `)
      .in('validation_status', ['approved', 'pending', 'matched'])

    // Apply filters
    if (startDate) {
      query = query.gte('created_at', startDate)
    }
    if (endDate) {
      query = query.lte('created_at', endDate)
    }
    if (!isSuperAdmin && warehouseOrgId) {
      query = query.eq('warehouse_org_id', warehouseOrgId)
    }
    if (distributorId) {
      query = query.eq('distributor_org_id', distributorId)
    }

    const { data: sessions, error } = await query

    if (error) {
      console.error('Reporting API Error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Process data for reporting
    const stats = {
      totalUnits: 0,
      totalCases: 0,
      totalOrders: new Set(),
      activeDistributors: new Set(),
      distributorPerformance: {} as Record<string, number>,
      productMix: {} as Record<string, number>,
      trend: {} as Record<string, number>,
      recentShipments: [] as any[]
    }

    sessions?.forEach((session: any) => {
      // Monthly aggregation (YYYY-MM)
      const dateObj = new Date(session.approved_at || session.updated_at || session.created_at)
      const date = dateObj.toISOString().slice(0, 7) // YYYY-MM
      const dailyDate = dateObj.toISOString().split('T')[0] // Keep daily for recent shipments display

      const distributorName = session.distributor?.org_name || session.destination_order?.buyer?.org_name || 'Unknown Distributor'
      const orderNo = session.destination_order?.order_no
      
      if (orderNo) stats.totalOrders.add(orderNo)
      stats.activeDistributors.add(distributorName)

      // Aggregate Units from scanned_quantities
      let sessionUnits = 0
      const quantities = session.scanned_quantities as any
      
      if (quantities && quantities.per_variant) {
        Object.entries(quantities.per_variant).forEach(([product, data]: [string, any]) => {
          const quantity = Number(data.units || 0)
          sessionUnits += quantity
          
          // Product Mix
          stats.productMix[product] = (stats.productMix[product] || 0) + quantity
        })
      } else if (quantities && quantities.total_units) {
        // Fallback if per_variant is missing but total_units exists
        sessionUnits = Number(quantities.total_units)
      }

      stats.totalUnits += sessionUnits
      
      // Distributor Performance
      stats.distributorPerformance[distributorName] = (stats.distributorPerformance[distributorName] || 0) + sessionUnits

      // Trend (Monthly)
      stats.trend[date] = (stats.trend[date] || 0) + sessionUnits

            // Recent Shipments (simplified)
      if (stats.recentShipments.length < 10) {
        stats.recentShipments.push({
          id: session.id,
          date: dailyDate,
          distributor: distributorName,
          orderNo: orderNo || '-',
          units: sessionUnits,
          status: session.validation_status
        })
      }
    })

    // Resolve Product Names
    const variantIds = Object.keys(stats.productMix)
    let productNames: Record<string, string> = {}
    
    if (variantIds.length > 0) {
      const { data: variants } = await supabase
        .from('product_variants')
        .select(`
          id,
          variant_name,
          product:products (
            product_name
          )
        `)
        .in('id', variantIds)
      
      variants?.forEach((v: any) => {
        // Construct a readable name: "Product Name - Variant Name" or just "Variant Name"
        const pName = v.product?.product_name
        const vName = v.variant_name
        const fullName = pName && vName && pName !== vName ? `${pName} - ${vName}` : (vName || pName || 'Unknown Product')
        
        // Extract content within brackets [ ]
        const match = fullName.match(/\[(.*?)\]/)
        const shortName = match ? match[1].trim() : fullName
        
        productNames[v.id] = shortName
      })
    }

    // Format for frontend
    const response = {
      summary: {
        totalUnits: stats.totalUnits,
        totalOrders: stats.totalOrders.size,
        activeDistributors: stats.activeDistributors.size,
      },
      trend: Object.entries(stats.trend)
        .map(([date, units]) => ({ date, units }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      productMix: Object.entries(stats.productMix)
        .map(([id, units]) => ({
          name: productNames[id] || 'Unknown Product',
          units
        }))
        .sort((a, b) => b.units - a.units)
        .slice(0, 5),
      distributorPerformance: Object.entries(stats.distributorPerformance)
        .map(([name, units]) => ({ name, units }))
        .sort((a, b) => b.units - a.units)
        .slice(0, 5),
      recentShipments: stats.recentShipments
    }

    return NextResponse.json(response)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
