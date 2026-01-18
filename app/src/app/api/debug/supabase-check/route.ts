import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Debug endpoint to check Supabase connection and RLS access
 * Call: GET /api/debug/supabase-check
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const testReporting = searchParams.get('testReporting') === 'true'
    
    const results: any = {
      timestamp: new Date().toISOString(),
      environment: {
        nodeEnv: process.env.NODE_ENV,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 40) + '...',
        hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      },
      auth: null,
      profile: null,
      dataCounts: {},
      errors: []
    }

    const supabase = await createClient()

    // 1. Check auth
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) {
      results.auth = { error: authError.message }
      results.errors.push(`Auth error: ${authError.message}`)
    } else if (!user) {
      results.auth = { error: 'No user found' }
      results.errors.push('No authenticated user')
    } else {
      results.auth = { 
        userId: user.id, 
        email: user.email,
        role: user.role
      }
    }

    // 2. Check profile (if authenticated)
    if (user) {
      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('id, email, role_code, organization_id, roles(role_level, role_name)')
        .eq('id', user.id)
        .single()

      if (profileError) {
        results.profile = { error: profileError.message }
        results.errors.push(`Profile error: ${profileError.message}`)
      } else {
        results.profile = profile
      }
    }

    // 3. Check data access (counts from key tables)
    const tables = ['orders', 'order_items', 'organizations', 'documents', 'product_inventory']
    
    for (const table of tables) {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })

      if (error) {
        results.dataCounts[table] = { error: error.message }
        results.errors.push(`${table} count error: ${error.message}`)
      } else {
        results.dataCounts[table] = count
      }
    }

    // 4. Check orders with specific statuses
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, status, created_at')
      .in('status', ['approved', 'closed', 'submitted'])
      .order('created_at', { ascending: false })
      .limit(5)

    if (ordersError) {
      results.recentOrders = { error: ordersError.message }
    } else {
      results.recentOrders = orders
    }

    // 5. TEST THE EXACT REPORTING QUERY if requested
    if (testReporting) {
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - 30)
      
      const { data: reportingOrders, error: reportingError } = await supabase
        .from('orders')
        .select(`
          id,
          order_no,
          status,
          paid_amount,
          created_at,
          buyer:organizations!orders_buyer_org_id_fkey (
            id,
            org_name,
            org_type_code
          ),
          order_items (
            id,
            variant_id,
            qty,
            unit_price,
            line_total
          )
        `)
        .in('status', ['approved', 'closed', 'submitted'])
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false })

      if (reportingError) {
        results.reportingTest = { error: reportingError.message }
        results.errors.push(`Reporting query error: ${reportingError.message}`)
      } else {
        // Calculate stats like the real API does
        let totalUnits = 0
        let totalRevenue = 0
        reportingOrders?.forEach((order: any) => {
          order.order_items?.forEach((item: any) => {
            totalUnits += item.qty || 0
            totalRevenue += Number(item.line_total) || 0
          })
        })
        
        results.reportingTest = {
          orderCount: reportingOrders?.length || 0,
          totalUnits,
          totalRevenue,
          sampleOrder: reportingOrders?.[0] ? {
            id: reportingOrders[0].id,
            status: reportingOrders[0].status,
            buyer: reportingOrders[0].buyer?.org_name,
            itemCount: reportingOrders[0].order_items?.length || 0
          } : null
        }
      }
    }

    return NextResponse.json(results, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 })
  }
}
