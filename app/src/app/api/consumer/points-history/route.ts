import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { resolveMobileConsumerWalletContext } from '@/lib/utils/qr-resolver'

/**
 * GET /api/consumer/points-history
 * Get authenticated shop user's points transaction history
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
        { success: false, error: 'Please log in to view points history' },
        { status: 401 }
      )
    }

    const walletContext = await resolveMobileConsumerWalletContext(supabaseAdmin, {
      userId: user.id,
    })

    let query = supabaseAdmin
      .from('shop_points_ledger')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(100)

    query = query.eq('consumer_id', user.id)

    // Execute query
    const { data: ledgerData, error: ledgerError } = await query

    if (ledgerError) {
      console.error('❌ Error fetching points history:', ledgerError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch points history' },
        { status: 500 }
      )
    }

    // Get images for variants and redeem items
    const variantIds = Array.from(new Set((ledgerData || []).map((entry: any) => entry.variant_id).filter(Boolean)))
    const redeemItemIds = Array.from(new Set((ledgerData || []).map((entry: any) => entry.redeem_item_id).filter(Boolean)))

    let variantImagesMap: { [key: string]: string } = {}
    let redeemItemImagesMap: { [key: string]: string } = {}

    if (variantIds.length > 0) {
      const { data: variants } = await supabaseAdmin
        .from('product_variants')
        .select('id, image_url')
        .in('id', variantIds)

      if (variants) {
        variantImagesMap = variants.reduce((acc: any, v: any) => {
          acc[v.id] = v.image_url
          return acc
        }, {})
      }
    }

    if (redeemItemIds.length > 0) {
      const { data: redeemItems } = await supabaseAdmin
        .from('redeem_items')
        .select('id, item_image_url')
        .in('id', redeemItemIds)

      if (redeemItems) {
        redeemItemImagesMap = redeemItems.reduce((acc: any, r: any) => {
          acc[r.id] = r.item_image_url
          return acc
        }, {})
      }
    }

    // Format the response
    const formattedTransactions = (ledgerData || []).map((entry: any) => {
      let imageUrl = null
      if (entry.variant_id) {
        imageUrl = variantImagesMap[entry.variant_id]
      } else if (entry.redeem_item_id) {
        imageUrl = redeemItemImagesMap[entry.redeem_item_id]
      }

      return {
        id: entry.id,
        type: entry.transaction_type,
        date: entry.occurred_at,
        points: entry.points_change,
        balance_after: null, // Not available in view
        description: entry.description,
        product_name: entry.product_name,
        variant_name: entry.variant_name,
        image_url: imageUrl
      }
    })

    // Calculate summary
    const totalEarned = formattedTransactions
      .filter((t: any) => t.points > 0)
      .reduce((sum: number, t: any) => sum + t.points, 0)

    const totalRedeemed = formattedTransactions
      .filter((t: any) => t.points < 0)
      .reduce((sum: number, t: any) => sum + Math.abs(t.points), 0)

    return NextResponse.json({
      success: true,
      transactions: formattedTransactions,
      summary: {
        total_earned: totalEarned,
        total_redeemed: totalRedeemed,
        current_balance: walletContext.balance,
        wallet_scope: walletContext.wallet_scope,
        wallet_owner_user_id: walletContext.wallet_owner_user_id,
        reporting_shop_id: walletContext.reporting_shop_id,
        balance_source: walletContext.balance_source,
      },
      count: formattedTransactions.length
    })

  } catch (error) {
    console.error('Error in consumer/points-history:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
