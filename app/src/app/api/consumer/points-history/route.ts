import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/consumer/points-history
 * Get authenticated shop user's points transaction history
 * Combines earn transactions (from scans) and redeem transactions
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

    // Get user's organization (shop)
    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('id, organization_id, phone')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile || !userProfile.organization_id) {
      console.error('❌ User profile not found:', profileError)
      return NextResponse.json(
        { success: false, error: 'User profile not found' },
        { status: 404 }
      )
    }

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
        { success: false, error: 'Only shop users can view points history' },
        { status: 403 }
      )
    }

    const shopId = organization.id

    // Get EARN transactions from consumer_qr_scans (where points were collected)
    const { data: earnScans, error: earnError } = await supabaseAdmin
      .from('consumer_qr_scans')
      .select(`
        id,
        scanned_at,
        points_amount,
        points_collected_at,
        qr_codes (
          id,
          code,
          products (
            id,
            product_name,
            product_image_url,
            variant_name
          )
        )
      `)
      .eq('shop_id', shopId)
      .eq('collected_points', true)
      .order('scanned_at', { ascending: false })
      .limit(100)

    if (earnError) {
      console.error('❌ Error fetching earn transactions:', earnError)
    }

    // Get REDEEM transactions from points_transactions
    const { data: redeemTxns, error: redeemError } = await supabaseAdmin
      .from('points_transactions')
      .select('*')
      .eq('company_id', shopId)
      .eq('transaction_type', 'redeem')
      .order('transaction_date', { ascending: false })
      .limit(100)

    if (redeemError) {
      console.error('❌ Error fetching redeem transactions:', redeemError)
    }

    // Get redeem items info for the redemptions
    const redeemItemIds = (redeemTxns || [])
      .map((txn: any) => txn.redeem_item_id)
      .filter(Boolean)
    
    let redeemItemsMap: { [key: string]: any } = {}
    if (redeemItemIds.length > 0) {
      const { data: redeemItems } = await supabaseAdmin
        .from('redeem_items')
        .select('id, item_name, item_image_url')
        .in('id', redeemItemIds)

      if (redeemItems) {
        redeemItemsMap = redeemItems.reduce((acc: any, item: any) => {
          acc[item.id] = item
          return acc
        }, {})
      }
    }

    // Combine and format all transactions
    const allTransactions: any[] = []

    // Add earn transactions
    for (const scan of (earnScans || [])) {
      const qrCode = scan.qr_codes as any
      const product = qrCode?.products as any
      
      allTransactions.push({
        id: scan.id,
        type: 'earn',
        date: scan.points_collected_at || scan.scanned_at,
        points: scan.points_amount || 0,
        description: product?.product_name || 'Points Earned',
        variant_name: product?.variant_name || null,
        image_url: product?.product_image_url || null,
        balance_after: null // Will calculate below
      })
    }

    // Add redeem transactions
    for (const txn of (redeemTxns || [])) {
      const redeemItem = redeemItemsMap[txn.redeem_item_id]
      
      allTransactions.push({
        id: txn.id,
        type: 'redeem',
        date: txn.transaction_date,
        points: txn.points_amount, // Already negative
        description: redeemItem?.item_name || txn.description || 'Redemption',
        variant_name: null,
        image_url: redeemItem?.item_image_url || null,
        balance_after: txn.balance_after
      })
    }

    // Sort by date descending
    allTransactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    // Calculate running balance for earn transactions that don't have it
    // Get current balance from latest redeem transaction or calculate from scratch
    let runningBalance = 0
    const totalEarned = allTransactions
      .filter(t => t.points > 0)
      .reduce((sum, t) => sum + t.points, 0)
    const totalRedeemed = allTransactions
      .filter(t => t.points < 0)
      .reduce((sum, t) => sum + Math.abs(t.points), 0)
    
    const currentBalance = totalEarned - totalRedeemed

    // Calculate balance_after for each transaction (going backwards in time)
    runningBalance = currentBalance
    for (const txn of allTransactions) {
      if (txn.balance_after === null) {
        txn.balance_after = runningBalance
      } else {
        runningBalance = txn.balance_after
      }
      // For the PREVIOUS transaction in time, subtract/add the current points
      runningBalance = runningBalance - txn.points
    }

    return NextResponse.json({
      success: true,
      transactions: allTransactions,
      summary: {
        total_earned: totalEarned,
        total_redeemed: totalRedeemed,
        current_balance: currentBalance
      },
      count: allTransactions.length
    })

  } catch (error) {
    console.error('Error in consumer/points-history:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
