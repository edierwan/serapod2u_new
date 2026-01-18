import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Debug endpoint to check Supabase connection and RLS access
 * Call: GET /api/debug/supabase-check
 */
export async function GET() {
  try {
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

    // 5. Check is_super_admin function (try calling it via RPC if available)
    // This won't work directly but we can infer from what data we get

    return NextResponse.json(results, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 })
  }
}
