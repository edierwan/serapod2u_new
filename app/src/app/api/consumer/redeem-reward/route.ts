import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    if (profileError || !userProfile || !userProfile.organization_id) {
      console.error('❌ User profile not found:', profileError)
      return NextResponse.json(
        { success: false, error: 'User profile not found' },
        { status: 404 }
      )
    }

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
        { success: false, error: 'Only shop users can redeem rewards' },
        { status: 403 }
      )
    }

    const shopId = organization.id
    console.log('✅ Shop user:', organization.org_name, 'Shop ID:', shopId)

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

    // 3. Check stock
    if (typeof reward.stock_quantity === 'number' && reward.stock_quantity <= 0) {
      return NextResponse.json(
        { success: false, error: 'This reward is out of stock' },
        { status: 400 }
      )
    }

    // 4. Get current points balance
    const { data: balanceData, error: balanceError } = await supabase
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

    const currentBalance = balanceData?.current_balance || 0
    console.log('💰 Current balance:', currentBalance, 'Required:', reward.points_required)

    // 5. Check if user has enough points
    if (currentBalance < reward.points_required) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Insufficient points. You need ${reward.points_required} points but have ${currentBalance}.`,
          current_balance: currentBalance,
          required: reward.points_required
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
    // Note: We DON'T set company_id here so the shop_points_ledger view
    // can use the subquery to find the shop by consumer_phone
    const consumerPhone = userProfile.phone || ''
    const newBalance = currentBalance - reward.points_required
    
    console.log('📝 Recording redemption:', {
      consumer_phone: consumerPhone,
      points_amount: -reward.points_required,
      balance_after: newBalance,
      reward_name: reward.item_name
    })
    
    const { data: transaction, error: txnError } = await supabase
      .from('points_transactions')
      .insert({
        company_id: reward.company_id, // Keep for reference
        consumer_phone: consumerPhone,
        consumer_email: consumer_email || userProfile.email || null,
        transaction_type: 'redeem',
        points_amount: -reward.points_required,
        balance_after: newBalance,
        redeem_item_id: reward_id,
        description: `Redeemed: ${reward.item_name}`,
        transaction_date: new Date().toISOString()
      })
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
      redemption_code: `RED-${transaction.id.split('-')[0].toUpperCase()}`,
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
