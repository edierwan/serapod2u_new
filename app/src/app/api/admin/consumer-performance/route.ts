import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

    const companyId = profile.organization_id
    if (!companyId) {
      return NextResponse.json({ success: true, data: [] })
    }

    const { data: distributors, error: distributorError } = await admin
      .from('organizations')
      .select('id')
      .eq('parent_org_id', companyId)
      .in('org_type_code', ['DIST'])
      .eq('is_active', true)

    if (distributorError) throw distributorError

    const distributorIds = distributors?.map((item) => item.id) || []
    let shopQuery = admin
      .from('organizations')
      .select('id')
      .in('org_type_code', ['SHOP'])
      .eq('is_active', true)

    if (distributorIds.length > 0) {
      shopQuery = shopQuery.or(`parent_org_id.in.(${distributorIds.join(',')}),parent_org_id.eq.${companyId}`)
    } else {
      shopQuery = shopQuery.eq('parent_org_id', companyId)
    }

    const { data: shopOrgs, error: shopError } = await shopQuery
    if (shopError) throw shopError

    const shopOrgIds = shopOrgs?.map((item) => item.id) || []
    const excludedUserIds = new Set<string>()

    if (shopOrgIds.length > 0) {
      const chunkSize = 100
      for (let index = 0; index < shopOrgIds.length; index += chunkSize) {
        const orgChunk = shopOrgIds.slice(index, index + chunkSize)
        const { data: shopUsers, error: shopUsersError } = await admin
          .from('users')
          .select('id')
          .in('organization_id', orgChunk)
          .in('role_code', ['GUEST', 'CONSUMER', 'USER'])
          .eq('is_active', true)

        if (shopUsersError) throw shopUsersError

        for (const item of shopUsers || []) {
          if (item.id) excludedUserIds.add(item.id)
        }
      }
    }

    const { data: consumerRows, error: consumerError } = await admin
      .from('v_consumer_points_balance')
      .select('*')
      .order('current_balance', { ascending: false })

    if (consumerError) throw consumerError

    const data = (consumerRows || []).filter((row: any) => !excludedUserIds.has(row.user_id))

    return NextResponse.json({ success: true, data })
  } catch (err: any) {
    console.error('consumer-performance error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}