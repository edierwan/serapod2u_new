import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/consumer/redemption-history
 * Get authenticated shop user's redemption history
 */
export async function GET(request: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing Supabase environment variables')
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      )
    }

    // Use service role client to bypass RLS
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Create regular client for auth check
    const { createClient: createServerClient } = await import('@/lib/supabase/server')
    const supabase = await createServerClient()

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Please log in to view redemption history' },
        { status: 401 }
      )
    }

    // Get user's organization (shop)
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('id, organization_id, phone')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      console.error('❌ User profile not found:', profileError)
      return NextResponse.json(
        { success: false, error: 'User profile not found' },
        { status: 404 }
      )
    }

    let shopId = user.id // Default to user ID for independent consumers

    // If user belongs to an organization, validate it
    if (userProfile.organization_id) {
      // Get organization details
      const { data: organization, error: orgError } = await supabaseAdmin
        .from('organizations')
        .select('id, org_type_code, org_name')
        .eq('id', userProfile.organization_id)
        .single()

      if (orgError || !organization) {
        console.error('❌ Organization not found:', orgError)
        return NextResponse.json(
          { success: false, error: 'Organization not found' },
          { status: 404 }
        )
      }

      if (organization.org_type_code !== 'SHOP') {
        return NextResponse.json(
          { success: false, error: 'Only shop users or independent consumers can view redemption history' },
          { status: 403 }
        )
      }

      shopId = organization.id
    }

    // Get redemption history (transaction_type = 'redeem')
    let query = supabaseAdmin
      .from('points_transactions')
      .select('*')
      .eq('transaction_type', 'redeem')
      .order('transaction_date', { ascending: false })
      .limit(50)

    if (userProfile.organization_id) {
      // Shop user: filter by company_id (shop ID)
      query = query.eq('company_id', shopId)
    } else {
      // Independent consumer: filter by user_id
      query = query.eq('user_id', user.id)
    }

    const { data: redemptions, error: redemptionsError } = await query

    if (redemptionsError) {
      console.error('❌ Error fetching redemption history:', redemptionsError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch redemption history' },
        { status: 500 }
      )
    }

    // Get redeem items for the redemptions
    const redeemItemIds = (redemptions || [])
      .map((txn: any) => txn.redeem_item_id)
      .filter(Boolean)

    let redeemItemsMap: { [key: string]: any } = {}
    if (redeemItemIds.length > 0) {
      const { data: redeemItems } = await supabaseAdmin
        .from('redeem_items')
        .select('id, item_name, item_image_url, points_required')
        .in('id', redeemItemIds)

      if (redeemItems) {
        redeemItemsMap = redeemItems.reduce((acc: any, item: any) => {
          acc[item.id] = item
          return acc
        }, {})
      }
    }

    // Format the response
    const formattedRedemptions = (redemptions || []).map((txn: any) => {
      const reward = redeemItemsMap[txn.redeem_item_id]
      return {
        id: txn.id,
        date: txn.transaction_date,
        points_deducted: Math.abs(txn.points_amount),
        description: txn.description,
        status: txn.fulfillment_status || 'pending',
        redemption_code: txn.redemption_code,
        reward: reward ? {
          id: reward.id,
          name: reward.item_name,
          image_url: reward.item_image_url,
          points_required: reward.points_required
        } : null
      }
    })

    return NextResponse.json({
      success: true,
      redemptions: formattedRedemptions,
      count: formattedRedemptions.length
    })

  } catch (error) {
    console.error('Error in consumer/redemption-history:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
