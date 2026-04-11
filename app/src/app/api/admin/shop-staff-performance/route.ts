import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/admin/shop-staff-performance
 * Returns shop staff performance rows across the current company hierarchy.
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

    const { data: distributors } = await admin
      .from('organizations')
      .select('id')
      .eq('parent_org_id', companyId)
      .in('org_type_code', ['DIST'])
      .eq('is_active', true)

    const distributorIds = distributors?.map((item) => item.id) || []

    let shopQuery = admin
      .from('organizations')
      .select('id, org_name')
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
    if (shopOrgIds.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }

    const shopNameById = new Map((shopOrgs || []).map((item) => [item.id, item.org_name]))

    const { data: staffUsers, error: usersError } = await admin
      .from('users')
      .select('id, full_name, phone, email, role_code, created_at, organization_id')
      .in('organization_id', shopOrgIds)
      .in('role_code', ['GUEST', 'CONSUMER', 'USER'])
      .eq('is_active', true)
      .order('full_name')

    if (usersError) throw usersError

    const userIds = staffUsers?.map((item) => item.id) || []
    const statsByUser = new Map<string, {
      current_balance: number
      total_collected_system: number
      total_collected_manual: number
      total_migration: number
      total_other: number
      total_redeemed: number
      other_types: Set<string>
      transaction_count: number
      last_transaction_date: string | null
    }>()

    if (userIds.length > 0) {
      const chunkSize = 100

      for (let index = 0; index < userIds.length; index += chunkSize) {
        const userIdChunk = userIds.slice(index, index + chunkSize)
        const { data: scanRows, error: scanError } = await admin
          .from('consumer_qr_scans')
          .select('consumer_id, points_amount, points_collected_at, is_manual_adjustment')
          .eq('collected_points', true)
          .in('consumer_id', userIdChunk)

        if (scanError) throw scanError

        for (const row of scanRows || []) {
          const userId = row.consumer_id
          if (!userId) continue
          const current = statsByUser.get(userId) || {
            current_balance: 0,
            total_collected_system: 0,
            total_collected_manual: 0,
            total_migration: 0,
            total_other: 0,
            total_redeemed: 0,
            other_types: new Set<string>(),
            transaction_count: 0,
            last_transaction_date: null,
          }

          const amount = Number(row.points_amount || 0)
          current.current_balance += amount
          current.transaction_count += 1
          if (row.is_manual_adjustment) {
            current.total_collected_manual += amount
          } else {
            current.total_collected_system += amount
          }
          if (!current.last_transaction_date || (row.points_collected_at && row.points_collected_at > current.last_transaction_date)) {
            current.last_transaction_date = row.points_collected_at
          }
          statsByUser.set(userId, current)
        }

        const { data: transactionRows, error: transactionError } = await admin
          .from('points_transactions')
          .select('user_id, transaction_type, points_amount, transaction_date')
          .in('user_id', userIdChunk)

        if (transactionError) throw transactionError

        for (const row of transactionRows || []) {
          const userId = row.user_id
          if (!userId) continue

          const current = statsByUser.get(userId) || {
            current_balance: 0,
            total_collected_system: 0,
            total_collected_manual: 0,
            total_migration: 0,
            total_other: 0,
            total_redeemed: 0,
            other_types: new Set<string>(),
            transaction_count: 0,
            last_transaction_date: null,
          }

          const amount = Number(row.points_amount || 0)
          const type = row.transaction_type || ''

          if (type !== 'adjust') {
            current.current_balance += amount
          }

          if (type === 'adjust') {
            current.total_collected_manual += amount
            current.current_balance += amount
          } else if (type === 'MIGRATION') {
            current.total_migration += amount
          } else if (type === 'redeem') {
            current.total_redeemed += Math.abs(amount)
          } else {
            current.total_other += amount
            if (type) current.other_types.add(type)
          }

          current.transaction_count += 1
          if (!current.last_transaction_date || (row.transaction_date && row.transaction_date > current.last_transaction_date)) {
            current.last_transaction_date = row.transaction_date
          }

          statsByUser.set(userId, current)
        }
      }
    }

    const data = (staffUsers || []).map((staff) => {
      const stats = statsByUser.get(staff.id)
      return {
        user_id: staff.id,
        consumer_name: staff.full_name || 'Unknown Shop Staff',
        consumer_phone: staff.phone,
        consumer_email: staff.email,
        consumer_location: null,
        consumer_reference: staff.role_code,
        referral_name: null,
        referral_email: null,
        referral_phone_full: null,
        consumer_shop_name: shopNameById.get(staff.organization_id || '') || null,
        current_balance: stats?.current_balance || 0,
        total_collected_system: stats?.total_collected_system || 0,
        total_collected_manual: stats?.total_collected_manual || 0,
        total_migration: stats?.total_migration || 0,
        total_other: stats?.total_other || 0,
        other_types: stats?.other_types ? Array.from(stats.other_types).join(', ') : null,
        total_redeemed: stats?.total_redeemed || 0,
        transaction_count: stats?.transaction_count || 0,
        last_transaction_date: stats?.last_transaction_date || null,
        last_migration_by_name: null,
      }
    })

    return NextResponse.json({ success: true, data })
  } catch (err: any) {
    console.error('shop-staff-performance error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
