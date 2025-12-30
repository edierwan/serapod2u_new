import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * POST /api/consumer/redeem-reward
 * Redeem a reward item using consumer's points
 * 
 * Body:
 *   reward_id: string - The reward item ID to redeem
 *   consumer_phone?: string - Consumer's phone (if not authenticated)
 *   consumer_email?: string - Consumer's email (if not authenticated)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Initialize admin client for balance checks (bypasses RLS)
    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { reward_id, consumer_phone, consumer_email } = await request.json()

    // Validate required fields
    if (!reward_id) {
      return NextResponse.json(
        { success: false, error: 'Reward ID is required' },
        { status: 400 }
      )
    }

    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Please log in to redeem rewards' },
        { status: 401 }
      )
    }

    console.log('🎁 Reward Redemption Request:', { reward_id, user_id: user.id })

    // 1. Get user's organization (shop)
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('id, organization_id, phone, email')
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
    let isIndependent = true

    // If user belongs to an organization, validate it
    if (userProfile.organization_id) {
      // 2. Get organization details
      const { data: organization, error: orgError } = await supabase
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
          { success: false, error: 'Only shop users or independent consumers can redeem rewards' },
          { status: 403 }
        )
      }

      shopId = organization.id
      isIndependent = false
      console.log('✅ Shop user:', organization.org_name, 'Shop ID:', shopId)
    } else {
      console.log('✅ Independent consumer:', user.id)
    }

    // 2. Get reward details
    const { data: reward, error: rewardError } = await supabase
      .from('redeem_items')
      .select('*')
      .eq('id', reward_id)
      .eq('is_active', true)
      .single()

    if (rewardError || !reward) {
      console.error('❌ Reward not found or inactive:', rewardError)
      return NextResponse.json(
        { success: false, error: 'Reward not found or no longer available' },
        { status: 404 }
      )
    }

    console.log('✅ Reward found:', reward.item_name, 'Points required:', reward.points_required)

    const pointsRequired = reward.point_offer || reward.points_required

    // 3. Check stock
    if (typeof reward.stock_quantity === 'number' && reward.stock_quantity <= 0) {
      return NextResponse.json(
        { success: false, error: 'This reward is out of stock' },
        { status: 400 }
      )
    }

    // 4. Get current points balance
    let currentBalance = 0

    if (!isIndependent) {
      const { data: balanceData, error: balanceError } = await supabaseAdmin
        .from('v_shop_points_balance')
        .select('*')
        .eq('shop_id', shopId)
        .maybeSingle()

      if (balanceError) {
        console.error('❌ Error fetching balance:', balanceError)
        return NextResponse.json(
          { success: false, error: 'Failed to fetch points balance' },
          { status: 500 }
        )
      }
      currentBalance = balanceData?.current_balance || 0
    } else {
      // Use the view for independent consumers to ensure consistency with the UI
      // This handles collected points, migration points, adjustments, and redemptions
      const { data: balanceData, error: balanceError } = await supabaseAdmin
        .from('v_consumer_points_balance')
        .select('current_balance')
        .eq('user_id', user.id)
        .maybeSingle()

      if (balanceError) {
        console.error('❌ Error fetching balance:', balanceError)
        return NextResponse.json(
          { success: false, error: 'Failed to fetch points balance' },
          { status: 500 }
        )
      }

      currentBalance = balanceData?.current_balance || 0
    }

    console.log('💰 Current balance:', currentBalance, 'Required:', pointsRequired)

    // 5. Check if user has enough points
    if (currentBalance < pointsRequired) {
      return NextResponse.json(
        {
          success: false,
          error: `Insufficient points. You need ${pointsRequired} points but have ${currentBalance}.`,
          current_balance: currentBalance,
          required: pointsRequired
        },
        { status: 400 }
      )
    }

    // 6. Check redemption limit per consumer (if applicable)
    if (reward.max_redemptions_per_consumer) {
      const phoneToCheck = consumer_phone || userProfile.phone
      if (phoneToCheck) {
        const { count, error: countError } = await supabase
          .from('points_transactions')
          .select('*', { count: 'exact', head: true })
          .eq('redeem_item_id', reward_id)
          .eq('consumer_phone', phoneToCheck)

        if (!countError && count && count >= reward.max_redemptions_per_consumer) {
          return NextResponse.json(
            {
              success: false,
              error: `You have reached the maximum redemption limit for this item (${reward.max_redemptions_per_consumer})`
            },
            { status: 400 }
          )
        }
      }
    }

    // 7. Record the redemption transaction
    // IMPORTANT: Use shopId (the shop's organization ID) as company_id
    // so the shop_points_ledger view can properly filter by shop_id
    const consumerPhone = userProfile.phone || ''
    const newBalance = currentBalance - pointsRequired

    // Generate redemption code (will be finalized after insert with transaction ID)
    const tempRedemptionCode = `RED-${Date.now().toString(36).toUpperCase()}`

    console.log('📝 Recording redemption:', {
      shop_id: shopId,
      consumer_phone: consumerPhone,
      points_amount: -pointsRequired,
      balance_after: newBalance,
      reward_name: reward.item_name
    })

    const { data: transaction, error: txnError } = await supabase
      .from('points_transactions')
      .insert({
        company_id: isIndependent ? null : shopId, // Use shop's org ID if available, else null
        consumer_phone: consumerPhone,
        consumer_email: consumer_email || userProfile.email || null,
        transaction_type: 'redeem',
        points_amount: -pointsRequired,
        balance_after: newBalance,
        redeem_item_id: reward_id,
        description: `Redeemed: ${reward.item_name}`,
        transaction_date: new Date().toISOString(),
        fulfillment_status: 'pending',
        redemption_code: tempRedemptionCode,
        user_id: user.id // Record the user ID for independent consumers
      } as any)
      .select()
      .single()

    if (txnError) {
      console.error('❌ Transaction error:', txnError)
      return NextResponse.json(
        { success: false, error: 'Failed to process redemption: ' + txnError.message },
        { status: 500 }
      )
    }

    console.log('✅ Transaction recorded:', transaction.id)

    // Generate final redemption code using transaction ID
    const redemptionCode = `RED-${transaction.id.split('-')[0].toUpperCase()}`

    // Update the transaction with the final redemption code
    await supabase
      .from('points_transactions')
      .update({ redemption_code: redemptionCode } as any)
      .eq('id', transaction.id)

    // 8. Update stock quantity (if applicable)
    if (typeof reward.stock_quantity === 'number' && reward.stock_quantity > 0) {
      const { error: stockError } = await supabase
        .from('redeem_items')
        .update({
          stock_quantity: reward.stock_quantity - 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', reward_id)

      if (stockError) {
        console.warn('⚠️ Failed to update stock (transaction completed):', stockError)
      } else {
        console.log('✅ Stock updated:', reward.stock_quantity - 1)
      }
    }

    // 9. Return success with details
    return NextResponse.json({
      success: true,
      message: 'Reward redeemed successfully!',
      transaction_id: transaction.id,
      reward_name: reward.item_name,
      points_deducted: reward.points_required,
      new_balance: newBalance,
      redemption_code: redemptionCode,
      instructions: 'Your redemption is being processed. Please show this confirmation to redeem your reward.'
    })

  } catch (error) {
    console.error('Error in consumer/redeem-reward:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
