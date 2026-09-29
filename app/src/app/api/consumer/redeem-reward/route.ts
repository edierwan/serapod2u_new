import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { validatePersonalCashbackBank } from '@/lib/engagement/personal-bank-details'

/**
 * POST /api/consumer/redeem-reward
 * Redeem a reward item (or collect a bonus-point reward) with the signed-in
 * consumer's points.
 *
 * Body:
 *   reward_id: string - The reward item ID to redeem
 *   request_key?: string - Idempotency key for this confirmation; a retry with
 *                          the same key returns the original result.
 *
 * The session only identifies the consumer. Every ledger effect (eligibility,
 * amount, wallet, balance, stock) is decided and written atomically by the
 * service-only public.consumer_reward_claim() database function; nothing the
 * browser sends is trusted beyond the reward id and the request key.
 */

type RewardClaimResult = {
  success: boolean
  status?: number
  code?: string
  error?: string
  replayed?: boolean
  transaction_id?: string
  is_bonus_points?: boolean
  points_change?: number
  required_points?: number
  new_balance?: number
  redemption_code?: string
  current_balance?: number
  required?: number
  wallet_scope?: 'consumer'
  wallet_owner_user_id?: string | null
  wallet_owner_org_id?: string | null
  reporting_shop_id?: string | null
}

const REQUEST_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Server-side client: reads and the ledger RPC run with the service role,
    // keyed only by the authenticated user id.
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

    const { reward_id, request_key } = await request.json()

    // Validate required fields
    if (!reward_id || typeof reward_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Reward ID is required' },
        { status: 400 }
      )
    }

    if (request_key !== undefined && request_key !== null
      && (typeof request_key !== 'string' || !REQUEST_KEY_PATTERN.test(request_key))) {
      return NextResponse.json(
        { success: false, error: 'Invalid request key' },
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

    const { data: userProfile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('id, bank_id, bank_account_number')
      .eq('id', user.id)
      .single()

    if (profileError || !userProfile) {
      console.error('❌ User profile not found:', profileError)
      return NextResponse.json(
        { success: false, error: 'User profile not found' },
        { status: 404 }
      )
    }

    const { data: reward, error: rewardError } = await supabaseAdmin
      .from('redeem_items')
      .select('id, item_name, item_code, category, collection_mode, per_user_limit, reward_message')
      .eq('id', reward_id)
      .eq('is_active', true)
      .maybeSingle()

    if (rewardError || !reward) {
      console.error('❌ Reward not found or inactive:', rewardError)
      return NextResponse.json(
        { success: false, error: 'Reward not found or no longer available' },
        { status: 404 }
      )
    }

    const isPointCategory = reward.category === 'point'
    const collectionMode = reward.collection_mode || 'always'
    const perUserLimit = reward.per_user_limit || false
    const isCashbackReward = !isPointCategory
      && typeof reward.item_code === 'string'
      && reward.item_code.toLowerCase().includes('cashback')

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

    const { data: claimData, error: claimError } = await supabaseAdmin.rpc('consumer_reward_claim' as any, {
      p_user_id: user.id,
      p_reward_id: reward.id,
      p_request_key: request_key || null,
    })

    if (claimError || !claimData) {
      console.error('❌ Reward claim failed:', claimError)
      return NextResponse.json(
        { success: false, error: 'Failed to process ' + (isPointCategory ? 'bonus points' : 'redemption') + '. Please try again.' },
        { status: 500 }
      )
    }

    const claim = claimData as RewardClaimResult

    if (!claim.success) {
      return NextResponse.json(
        {
          success: false,
          error: claim.error || 'Failed to redeem reward',
          code: claim.code,
          ...(typeof claim.current_balance === 'number' ? { current_balance: claim.current_balance } : {}),
          ...(typeof claim.required === 'number' ? { required: claim.required } : {}),
        },
        { status: claim.status || 400 }
      )
    }

    console.log('✅ Reward ledger recorded:', {
      transaction_id: claim.transaction_id,
      points_change: claim.points_change,
      balance_after: claim.new_balance,
      replayed: claim.replayed,
    })

    const walletFields = {
      wallet_scope: claim.wallet_scope,
      wallet_owner_user_id: claim.wallet_owner_user_id,
      wallet_owner_org_id: claim.wallet_owner_org_id,
      reporting_shop_id: claim.reporting_shop_id,
      balance_source: 'consumer_view',
      replayed: claim.replayed === true,
    }

    // For Point category, return bonus-specific response
    if (claim.is_bonus_points) {
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
        transaction_id: claim.transaction_id,
        reward_name: reward.item_name,
        points_earned: claim.points_change,
        new_balance: claim.new_balance,
        redemption_code: claim.redemption_code,
        collection_mode: collectionMode,
        per_user_limit: perUserLimit,
        ...walletFields,
      })
    }

    return NextResponse.json({
      success: true,
      message: 'Reward redeemed successfully!',
      transaction_id: claim.transaction_id,
      reward_name: reward.item_name,
      points_deducted: claim.required_points,
      new_balance: claim.new_balance,
      redemption_code: claim.redemption_code,
      instructions: 'Your redemption is being processed. Please show this confirmation to redeem your reward.',
      ...walletFields,
    })

  } catch (error) {
    console.error('Error in consumer/redeem-reward:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
