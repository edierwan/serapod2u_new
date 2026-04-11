import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { loadScopedShopUsers } from '../_user-management-scope'

/**
 * GET /api/admin/consumer-performance
 * Returns non-shop consumer performance rows for the current company scope.
 */
export async function GET(_request: NextRequest) {
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

    const { data: profile } = await admin
      .from('users')
      .select('role_code, organization_id')
      .eq('id', user.id)
      .single()

    if (!profile || !['SA', 'HQ', 'POWER_USER'].includes(profile.role_code)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { shopUsers } = await loadScopedShopUsers(admin, profile.role_code, profile.organization_id)
    const excludedUserIds = new Set(shopUsers.map((item) => item.id))

    const { data: consumerScanRows, error: consumerScanError } = await admin
      .from('consumer_qr_scans')
      .select('consumer_id')
      .eq('claim_lane', 'consumer')
      .eq('collected_points', true)

    if (consumerScanError) throw consumerScanError

    const consumerLaneUserIds = new Set(
      (consumerScanRows || [])
        .map((row: any) => row.consumer_id)
        .filter(Boolean)
    )

    const { data: consumerRows, error: consumerError } = await admin
      .from('v_consumer_points_balance')
      .select('*')
      .order('current_balance', { ascending: false })

    if (consumerError) throw consumerError

    const data = (consumerRows || []).filter((row: any) => {
      if (excludedUserIds.has(row.user_id)) return false
      if (!consumerLaneUserIds.has(row.user_id)) return false
      return true
    })

    return NextResponse.json({ success: true, data })
  } catch (err: any) {
    console.error('consumer-performance error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}