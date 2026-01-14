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

    // Check if this is a Point category reward (bonus points)
    const isPointCategory = reward.category === 'point'
    const pointRewardAmount = (reward as any).point_reward_amount || 0
    const collectionMode = (reward as any).collection_mode || 'always'
    const perUserLimit = (reward as any).per_user_limit || false
    
    // For Point category, points_required should be 0 (free to collect)
    const pointsRequired = isPointCategory ? 0 : (reward.point_offer || reward.points_required)

    // 3. Check stock (skip for Point category which typically has unlimited stock)
    if (!isPointCategory && typeof reward.stock_quantity === 'number' && reward.stock_quantity <= 0) {
      return NextResponse.json(
        { success: false, error: 'This reward is out of stock' },
        { status: 400 }
      )
    }

    // 3.5 For Point category, check collection restrictions
    if (isPointCategory) {
      const consumerPhone = userProfile.phone || ''
      
      // Check per-user limit
      if (perUserLimit) {
        // Get previous collections of this reward by this user
        const { data: previousCollections, error: prevError } = await supabaseAdmin
          .from('points_transactions')
          .select('id, created_at')
          .eq('redeem_item_id', reward_id)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
        
        if (previousCollections && previousCollections.length > 0) {
          if (collectionMode === 'once') {
            // One-time collection only
            return NextResponse.json(
              { success: false, error: 'You have already collected this reward. One-time collection only!' },
              { status: 400 }
            )
          } else if (collectionMode === 'daily') {
            // Check if already collected today
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const lastCollection = new Date(previousCollections[0].created_at)
            lastCollection.setHours(0, 0, 0, 0)
            
            if (lastCollection.getTime() >= today.getTime()) {
              return NextResponse.json(
                { success: false, error: 'You have already collected today! Come back tomorrow to collect again.' },
                { status: 400 }
              )
            }
          }
        }
      } else if (collectionMode === 'daily') {
        // Daily collection without per-user tracking (by phone)
        const today = new Date().toISOString().split('T')[0]
        const { count } = await supabaseAdmin
          .from('points_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('redeem_item_id', reward_id)
          .eq('consumer_phone', consumerPhone)
          .gte('created_at', `${today}T00:00:00.000Z`)
        
        if (count && count > 0) {
          return NextResponse.json(
            { success: false, error: 'You have already collected today! Come back tomorrow.' },
            { status: 400 }
          )
        }
      }
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
    
    // For Point category, we ADD points instead of deducting
    const pointsChange = isPointCategory ? pointRewardAmount : -pointsRequired
    const newBalance = currentBalance + pointsChange

    // Generate redemption code (will be finalized after insert with transaction ID)
    const tempRedemptionCode = isPointCategory 
      ? `BONUS-${Date.now().toString(36).toUpperCase()}`
      : `RED-${Date.now().toString(36).toUpperCase()}`

    console.log('📝 Recording ' + (isPointCategory ? 'bonus points' : 'redemption') + ':', {
      shop_id: shopId,
      consumer_phone: consumerPhone,
      points_amount: pointsChange,
      balance_after: newBalance,
      reward_name: reward.item_name
    })

    const { data: transaction, error: txnError } = await supabase
      .from('points_transactions')
      .insert({
        company_id: isIndependent ? null : shopId, // Use shop's org ID if available, else null
        consumer_phone: consumerPhone,
        consumer_email: consumer_email || userProfile.email || null,
        transaction_type: isPointCategory ? 'collect' : 'redeem',  // Use 'collect' for bonus points
        points_amount: pointsChange,
        balance_after: newBalance,
        redeem_item_id: reward_id,
        description: isPointCategory 
          ? `Bonus Points: ${reward.item_name}` 
          : `Redeemed: ${reward.item_name}`,
        transaction_date: new Date().toISOString(),
        fulfillment_status: isPointCategory ? 'fulfilled' : 'pending',
        redemption_code: tempRedemptionCode,
        user_id: user.id // Record the user ID for independent consumers
      } as any)
      .select()
      .single()

    if (txnError) {
      console.error('❌ Transaction error:', txnError)
      return NextResponse.json(
        { success: false, error: 'Failed to process ' + (isPointCategory ? 'bonus points' : 'redemption') + ': ' + txnError.message },
        { status: 500 }
      )
    }

    console.log('✅ Transaction recorded:', transaction.id)

    // Generate final redemption code using transaction ID
    const redemptionCode = isPointCategory 
      ? `BONUS-${transaction.id.split('-')[0].toUpperCase()}`
      : `RED-${transaction.id.split('-')[0].toUpperCase()}`

    // Update the transaction with the final redemption code
    await supabase
      .from('points_transactions')
      .update({ redemption_code: redemptionCode } as any)
      .eq('id', transaction.id)

    // 8. Update stock quantity (if applicable - skip for Point category)
    if (!isPointCategory && typeof reward.stock_quantity === 'number' && reward.stock_quantity > 0) {
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
    // For Point category, return bonus-specific response
    if (isPointCategory) {
      // Determine congratulatory message based on collection mode
      let congratsMessage = 'Congratulations! You\'ve earned bonus points!'
      let encourageMessage = ''
      
      if (perUserLimit && collectionMode === 'daily') {
        congratsMessage = '🎉 Daily Bonus Collected!'
        encourageMessage = 'Come back tomorrow to collect more points. Stay loyal, earn more!'
      } else if (perUserLimit && collectionMode === 'once') {
        congratsMessage = '🌟 Thank You, Loyal Customer!'
        encourageMessage = 'Check back often for more exciting rewards and bonuses!'
      } else if (collectionMode === 'daily') {
        congratsMessage = '✨ Daily Bonus Unlocked!'
        encourageMessage = 'Visit us every day to keep earning bonus points!'
      } else {
        congratsMessage = '🎁 Bonus Points Added!'
        encourageMessage = reward.reward_message || 'Thank you for being an amazing customer!'
      }
      
      return NextResponse.json({
        success: true,
        is_bonus_points: true,
        message: congratsMessage,
        encourage_message: encourageMessage,
        reward_message: reward.reward_message || null,
        transaction_id: transaction.id,
        reward_name: reward.item_name,
        points_earned: pointRewardAmount,
        new_balance: newBalance,
        redemption_code: redemptionCode,
        collection_mode: collectionMode,
        per_user_limit: perUserLimit
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Reward redeemed successfully!',
      transaction_id: transaction.id,
      reward_name: reward.item_name,
      points_deducted: pointsRequired,
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
