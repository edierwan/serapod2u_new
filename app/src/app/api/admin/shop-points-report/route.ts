import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/admin/shop-points-report
 * Returns shop-level points summary from v_shop_points_summary view
 */
export async function GET(request: NextRequest) {
  try {
    const { createClient: createServerClient } = await import('@/lib/supabase/server')
    const supabase = await createServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Check admin role
    const { data: profile } = await admin
      .from('users')
      .select('role_code')
      .eq('id', user.id)
      .single()

    if (!profile || !['SA', 'HQ', 'POWER_USER'].includes(profile.role_code)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await admin
      .from('v_shop_points_summary')
      .select('*')
      .order('total_points_balance', { ascending: false })

    if (error) throw error

    // Compute totals
    const totals = {
      total_shops: data?.length ?? 0,
      shops_with_consumers: data?.filter(d => d.total_consumers > 0).length ?? 0,
      grand_total_balance: data?.reduce((s, d) => s + (d.total_points_balance || 0), 0) ?? 0,
      grand_total_consumers: data?.reduce((s, d) => s + (d.total_consumers || 0), 0) ?? 0,
      grand_total_redeemed: data?.reduce((s, d) => s + (d.total_redeemed || 0), 0) ?? 0,
    }

    return NextResponse.json({ success: true, data, totals })
  } catch (err: any) {
    console.error('shop-points-report error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
