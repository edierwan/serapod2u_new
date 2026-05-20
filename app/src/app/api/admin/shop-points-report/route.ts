import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { summarizeShopUserPointsReporting } from '@/lib/reporting/shop-user-points'

/**
 * GET /api/admin/shop-points-report
 * Returns shop-level reporting based on attached users' individual wallets.
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

    const { data: shops, error: shopsError } = await admin
      .from('organizations')
      .select('id, org_name, branch, contact_name, contact_phone, state_id')
      .eq('org_type_code', 'SHOP')
      .order('org_name', { ascending: true })

    if (shopsError) throw shopsError

    const shopIds = (shops || []).map((row: any) => row.id).filter(Boolean)
    const bonusByUser = new Map<string, number>()
    let referenceByShop = new Map<string, string>()
    const anonymousMetricsByShop = new Map<string, { anonymousShopScanPoints: number; anonymousShopScanCount: number }>()
    const usersByShop = new Map<string, Array<{ id: string; referral_phone: string | null }>>()
    const balanceByUser = new Map<string, any>()
    const stateById = new Map<string, string>()

    const stateIds = Array.from(new Set((shops || []).map((row: any) => row.state_id).filter(Boolean)))

    if (stateIds.length > 0) {
      const { data: states, error: statesError } = await admin
        .from('states')
        .select('id, state_name')
        .in('id', stateIds)

      if (statesError) throw statesError

      for (const state of states || []) {
        stateById.set(state.id, state.state_name || '')
      }
    }

    if (shopIds.length > 0) {
      const chunkSize = 100

      for (let index = 0; index < shopIds.length; index += chunkSize) {
        const shopIdChunk = shopIds.slice(index, index + chunkSize)

        const { data: shopUsers, error: shopUsersError } = await admin
          .from('users')
          .select('id, organization_id, referral_phone')
          .in('organization_id', shopIdChunk)
          .in('role_code', ['GUEST', 'CONSUMER', 'USER'])

        if (shopUsersError) throw shopUsersError

        for (const shopUser of shopUsers || []) {
          if (!shopUser.organization_id) continue
          const currentUsers = usersByShop.get(shopUser.organization_id) || []
          currentUsers.push({ id: shopUser.id, referral_phone: shopUser.referral_phone || null })
          usersByShop.set(shopUser.organization_id, currentUsers)
        }

        const userIds = (shopUsers || []).map((row: any) => row.id).filter(Boolean)

        if (userIds.length > 0) {
          const { data: userBalances, error: userBalancesError } = await admin
            .from('v_consumer_points_balance')
            .select('user_id, current_balance, total_collected_system, total_collected_manual, total_migration, total_redeemed, transaction_count, last_transaction_date')
            .in('user_id', userIds)

          if (userBalancesError) throw userBalancesError

          for (const row of userBalances || []) {
            if (!row.user_id) continue
            balanceByUser.set(row.user_id, row)
          }

          const { data: bonusRows, error: bonusError } = await admin
            .from('points_transactions')
            .select('user_id, points_amount, transaction_type, point_category')
            .in('user_id', userIds)
            .or('transaction_type.eq.earn,point_category.eq.bonus')

          if (bonusError) throw bonusError

          for (const row of bonusRows || []) {
            if (!row.user_id) continue
            bonusByUser.set(
              row.user_id,
              (bonusByUser.get(row.user_id) || 0) + Number(row.points_amount || 0)
            )
          }
        }

        const { data: anonymousScanRows, error: anonymousScanError } = await admin
          .from('consumer_qr_scans')
          .select('shop_id, points_amount')
          .in('shop_id', shopIdChunk)
          .is('consumer_id', null)
          .eq('collected_points', true)

        if (anonymousScanError) throw anonymousScanError

        for (const row of anonymousScanRows || []) {
          if (!row.shop_id) continue
          const current = anonymousMetricsByShop.get(row.shop_id) || {
            anonymousShopScanPoints: 0,
            anonymousShopScanCount: 0,
          }
          current.anonymousShopScanPoints += Number(row.points_amount || 0)
          current.anonymousShopScanCount += 1
          anonymousMetricsByShop.set(row.shop_id, current)
        }

        const normalizedReferralPhones = Array.from(new Set((shopUsers || []).map((row: any) => row.referral_phone).filter(Boolean)))
        const normalizedPhoneMap = new Map<string, any>()

        if (normalizedReferralPhones.length > 0) {
          const { data: referenceUsers, error: referenceUsersError } = await admin
            .from('users')
            .select('full_name, phone')

          if (referenceUsersError) throw referenceUsersError

          for (const item of referenceUsers || []) {
            const phone = String(item.phone || '').replace(/\D/g, '')
            if (!phone) continue
            normalizedPhoneMap.set(phone, item)
            if (phone.startsWith('0')) normalizedPhoneMap.set(`6${phone}`, item)
          }
        }

        for (const shopUser of shopUsers || []) {
          const shopId = shopUser.organization_id
          if (!shopId || referenceByShop.has(shopId) || !shopUser.referral_phone) continue
          const normalized = String(shopUser.referral_phone).replace(/\D/g, '')
          const referenceUser = normalizedPhoneMap.get(normalized) || normalizedPhoneMap.get(normalized.startsWith('0') ? `6${normalized}` : normalized)
          referenceByShop.set(shopId, referenceUser?.full_name || shopUser.referral_phone)
        }
      }
    }

    const enrichedData = (shops || [])
      .map((shop: any) => {
        const members = (usersByShop.get(shop.id) || []).map((shopUser) => {
          const balanceRow = balanceByUser.get(shopUser.id)
          return {
            userId: shopUser.id,
            currentBalance: Number(balanceRow?.current_balance || 0),
            totalCollectedSystem: Number(balanceRow?.total_collected_system || 0),
            totalCollectedManual: Number(balanceRow?.total_collected_manual || 0),
            totalMigration: Number(balanceRow?.total_migration || 0),
            totalRedeemed: Number(balanceRow?.total_redeemed || 0),
            totalBonusPoints: Number(bonusByUser.get(shopUser.id) || 0),
            transactionCount: Number(balanceRow?.transaction_count || 0),
            lastActivity: balanceRow?.last_transaction_date || null,
          }
        })

        const summary = summarizeShopUserPointsReporting(
          members,
          anonymousMetricsByShop.get(shop.id)
        )

        return {
          shop_id: shop.id,
          shop_name: shop.org_name,
          branch_name: shop.branch || null,
          shop_reference_am: referenceByShop.get(shop.id) || null,
          contact_name: shop.contact_name || null,
          contact_phone: shop.contact_phone || null,
          state: stateById.get(shop.state_id) || null,
          total_attached_users: summary.totalAttachedUsers,
          total_consumers: summary.totalAttachedUsers,
          shop_current_user_balance: summary.shopCurrentUserBalance,
          total_points_balance: summary.shopCurrentUserBalance,
          total_collected_system: summary.totalCollectedSystem,
          total_bonus_points: summary.totalBonusPoints,
          total_collected_manual: summary.totalCollectedManual,
          total_migration_points: summary.totalMigrationPoints,
          total_redeemed_by_attached_users: summary.totalRedeemedByAttachedUsers,
          total_redeemed: summary.totalRedeemedByAttachedUsers,
          total_earned_by_attached_users: summary.totalEarnedByAttachedUsers,
          total_transactions: summary.totalTransactions,
          last_activity: summary.lastActivity,
          anonymous_shop_scan_points: summary.anonymousShopScanPoints,
          anonymous_shop_scan_count: summary.anonymousShopScanCount,
        }
      })
      .sort((left: any, right: any) => (right.shop_current_user_balance || 0) - (left.shop_current_user_balance || 0))

    // Compute totals
    const totals = {
      total_shops: enrichedData.length,
      shops_with_consumers: enrichedData.filter(d => d.total_attached_users > 0).length,
      grand_total_balance: enrichedData.reduce((s, d) => s + (d.shop_current_user_balance || 0), 0),
      grand_total_consumers: enrichedData.reduce((s, d) => s + (d.total_attached_users || 0), 0),
      grand_total_redeemed: enrichedData.reduce((s, d) => s + (d.total_redeemed || 0), 0),
      grand_total_bonus: enrichedData.reduce((s, d) => s + (d.total_bonus_points || 0), 0),
    }

    return NextResponse.json({ success: true, data: enrichedData, totals })
  } catch (err: any) {
    console.error('shop-points-report error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
