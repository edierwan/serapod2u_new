import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

    // Get points transaction history
    const { data: transactions, error: transactionsError } = await supabaseAdmin
      .from('points_transactions')
      .select('*')
      .eq('company_id', shopId)
      .order('transaction_date', { ascending: false })
      .limit(100)

    if (transactionsError) {
      console.error('❌ Error fetching points history:', transactionsError)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch points history' },
        { status: 500 }
      )
    }

    // Format the response
    const formattedTransactions = (transactions || []).map((txn: any) => ({
      id: txn.id,
      type: txn.transaction_type,
      date: txn.transaction_date,
      points: txn.points_amount,
      balance_after: txn.balance_after,
      description: txn.description
    }))

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
        current_balance: formattedTransactions.length > 0 ? formattedTransactions[0].balance_after : 0
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
