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

    const shopIds = (data || []).map((row: any) => row.shop_id).filter(Boolean)
    let bonusByShop = new Map<string, number>()
    let referenceByShop = new Map<string, string>()

    if (shopIds.length > 0) {
      const chunkSize = 100

      for (let index = 0; index < shopIds.length; index += chunkSize) {
        const shopIdChunk = shopIds.slice(index, index + chunkSize)
        const { data: bonusRows, error: bonusError } = await admin
          .from('shop_points_ledger')
          .select('shop_id, points_change, transaction_type, point_category')
          .in('shop_id', shopIdChunk)
          .or('transaction_type.eq.earn,point_category.eq.bonus')

        if (bonusError) throw bonusError

        for (const row of bonusRows || []) {
          if (!row.shop_id) continue
          bonusByShop.set(row.shop_id, (bonusByShop.get(row.shop_id) || 0) + Number(row.points_change || 0))
        }

        const { data: shopUsers, error: shopUsersError } = await admin
          .from('users')
          .select('organization_id, referral_phone')
          .in('organization_id', shopIdChunk)

        if (shopUsersError) throw shopUsersError

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

    const enrichedData = (data || []).map((row: any) => ({
      ...row,
      total_bonus_points: bonusByShop.get(row.shop_id) || 0,
      shop_reference_am: referenceByShop.get(row.shop_id) || null,
    }))

    // Compute totals
    const totals = {
      total_shops: enrichedData.length,
      shops_with_consumers: enrichedData.filter(d => d.total_consumers > 0).length,
      grand_total_balance: enrichedData.reduce((s, d) => s + (d.total_points_balance || 0), 0),
      grand_total_consumers: enrichedData.reduce((s, d) => s + (d.total_consumers || 0), 0),
      grand_total_redeemed: enrichedData.reduce((s, d) => s + (d.total_redeemed || 0), 0),
      grand_total_bonus: enrichedData.reduce((s, d) => s + (d.total_bonus_points || 0), 0),
    }

    return NextResponse.json({ success: true, data: enrichedData, totals })
  } catch (err: any) {
    console.error('shop-points-report error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
