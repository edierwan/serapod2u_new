import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { buildConsumerRewardRedemptionPlan } from '@/lib/engagement/consumer-reward-wallet'
import { validatePersonalCashbackBank } from '@/lib/engagement/personal-bank-details'
import { resolveMobileConsumerWalletContext } from '@/lib/utils/qr-resolver'

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

    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('id, organization_id, phone, email, role_code, bank_id, bank_account_number')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      console.error('❌ User profile not found:', profileError)
      return NextResponse.json(
        { success: false, error: 'User profile not found' },
        { status: 404 }
      )
    }

    let organizationTypeCode: string | null = null

    if (userProfile.organization_id) {
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

      organizationTypeCode = organization.org_type_code || null

      if (organizationTypeCode !== 'SHOP') {
        return NextResponse.json(
          { success: false, error: 'Only shop users or independent consumers can redeem rewards' },
          { status: 403 }
        )
      }

      console.log('✅ Shop-linked mobile user:', organization.org_name, 'Shop ID:', organization.id)
    } else {
      console.log('✅ Independent consumer:', user.id)
    }

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

    const isPointCategory = reward.category === 'point'
    const pointRewardAmount = (reward as any).point_reward_amount || 0
    const collectionMode = (reward as any).collection_mode || 'always'
    const perUserLimit = (reward as any).per_user_limit || false
    const rewardWalletScope = (reward as any).wallet_scope || 'consumer'
    const consumerPhone = userProfile.phone || ''
    const isCashbackReward = !isPointCategory
      && typeof reward.item_code === 'string'
      && reward.item_code.toLowerCase().includes('cashback')

    const pointsRequired = isPointCategory ? 0 : (reward.point_offer || reward.points_required)

    if (rewardWalletScope !== 'consumer') {
      return NextResponse.json(
        {
          success: false,
          error: 'Shop wallet rewards are disabled for mobile redemption.',
          wallet_scope: rewardWalletScope,
        },
        { status: 403 }
      )
    }

    if (isCashbackReward) {
      const bankId = userProfile.bank_id || null
      let bankRule = null

      if (bankId) {
        const { data: bankData, error: bankError } = await supabaseAdmin
          .from('msia_banks')
          .select('id, short_name, min_account_length, max_account_length, is_numeric_only, is_active')
          .eq('id', bankId)
          .maybeSingle()

        if (bankError) {
          console.error('❌ Failed to validate personal bank details:', bankError)
          return NextResponse.json(
            { success: false, error: 'Failed to validate personal bank details' },
            { status: 500 }
          )
        }

        bankRule = bankData
      }

      const bankValidation = validatePersonalCashbackBank({
        bankId,
        bankAccountNumber: userProfile.bank_account_number,
        bank: bankRule,
      })

      if (!bankValidation.isValid) {
        return NextResponse.json(
          { success: false, error: bankValidation.error },
          { status: 400 }
        )
      }
    }

    if (!isPointCategory && typeof reward.stock_quantity === 'number' && reward.stock_quantity <= 0) {
      return NextResponse.json(
        { success: false, error: 'This reward is out of stock' },
        { status: 400 }
      )
    }

    if (isPointCategory) {
      if (perUserLimit) {
        const { data: previousCollections, error: prevError } = await supabaseAdmin
          .from('points_transactions')
          .select('id, created_at')
          .eq('redeem_item_id', reward_id)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })

        if (previousCollections && previousCollections.length > 0) {
          if (collectionMode === 'once') {
            return NextResponse.json(
              { success: false, error: 'You have already collected this reward. One-time collection only!' },
              { status: 400 }
            )
          } else if (collectionMode === 'daily') {
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

    const walletContext = await resolveMobileConsumerWalletContext(supabaseAdmin, {
      userId: user.id,
      roleCode: userProfile.role_code,
      organizationId: userProfile.organization_id,
      organizationTypeCode,
    })

    const redemptionPlan = buildConsumerRewardRedemptionPlan({
      wallet: walletContext,
      reward: {
        id: reward.id,
        itemName: reward.item_name,
        category: reward.category,
        pointsRequired: reward.points_required,
        pointOffer: (reward as any).point_offer,
        pointRewardAmount,
        walletScope: rewardWalletScope,
      },
      user: {
        id: user.id,
        phone: consumerPhone,
        email: consumer_email || userProfile.email || null,
      },
    })

    console.log('💰 Mobile wallet balance:', walletContext.balance, 'Required:', pointsRequired, 'Source:', walletContext.balance_source)

    if (!redemptionPlan.success) {
      return NextResponse.json(
        {
          success: false,
          error: redemptionPlan.error,
          current_balance: redemptionPlan.currentBalance,
          required: redemptionPlan.requiredPoints,
          wallet_scope: walletContext.wallet_scope,
          wallet_owner_user_id: walletContext.wallet_owner_user_id,
          wallet_owner_org_id: walletContext.wallet_owner_org_id,
          reporting_shop_id: walletContext.reporting_shop_id,
          balance_source: walletContext.balance_source,
        },
        { status: redemptionPlan.status }
      )
    }

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

    if (!redemptionPlan.transactionInsert) {
      return NextResponse.json(
        { success: false, error: 'Failed to prepare redemption transaction' },
        { status: 500 }
      )
    }

    console.log('📝 Recording ' + (isPointCategory ? 'bonus points' : 'redemption') + ':', {
      wallet_scope: redemptionPlan.walletScope,
      wallet_owner_user_id: redemptionPlan.walletOwnerUserId,
      reporting_shop_id: redemptionPlan.reportingShopId,
      consumer_phone: redemptionPlan.transactionInsert.consumer_phone,
      points_amount: redemptionPlan.pointsChange,
      balance_after: redemptionPlan.newBalance,
      reward_name: reward.item_name
    })

    const { data: transaction, error: txnError } = await supabase
      .from('points_transactions')
      .insert(redemptionPlan.transactionInsert as any)
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
        new_balance: redemptionPlan.newBalance,
        redemption_code: redemptionCode,
        collection_mode: collectionMode,
        per_user_limit: perUserLimit,
        wallet_scope: redemptionPlan.walletScope,
        wallet_owner_user_id: redemptionPlan.walletOwnerUserId,
        wallet_owner_org_id: redemptionPlan.walletOwnerOrgId,
        reporting_shop_id: redemptionPlan.reportingShopId,
        balance_source: redemptionPlan.balanceSource,
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Reward redeemed successfully!',
      transaction_id: transaction.id,
      reward_name: reward.item_name,
      points_deducted: redemptionPlan.requiredPoints,
      new_balance: redemptionPlan.newBalance,
      redemption_code: redemptionCode,
      instructions: 'Your redemption is being processed. Please show this confirmation to redeem your reward.',
      wallet_scope: redemptionPlan.walletScope,
      wallet_owner_user_id: redemptionPlan.walletOwnerUserId,
      wallet_owner_org_id: redemptionPlan.walletOwnerOrgId,
      reporting_shop_id: redemptionPlan.reportingShopId,
      balance_source: redemptionPlan.balanceSource,
    })

  } catch (error) {
    console.error('Error in consumer/redeem-reward:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
