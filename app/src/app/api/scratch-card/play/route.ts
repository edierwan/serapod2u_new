import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    const supabase = await createClient()
    const body = await request.json()
    const { campaignId, consumerPhone, consumerName, qrCodeId } = body

    if (!campaignId || !consumerPhone) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 1. Check Campaign Status
    const { data: campaign, error: campaignError } = await supabase
        .from('scratch_card_campaigns')
        .select('*')
        .eq('id', campaignId)
        .single()

    if (campaignError || !campaign) {
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    if (campaign.status !== 'active') {
        return NextResponse.json({ error: 'Campaign is not active' }, { status: 400 })
    }

    const now = new Date()
    if (campaign.start_at && new Date(campaign.start_at) > now) {
        return NextResponse.json({ error: 'Campaign has not started yet' }, { status: 400 })
    }
    if (campaign.end_at && new Date(campaign.end_at) < now) {
        return NextResponse.json({ error: 'Campaign has ended' }, { status: 400 })
    }

    // 2. Check Limits
    // Max plays per day
    const today = new Date().toISOString().split('T')[0]
    const { count: playsToday, error: playsError } = await supabase
        .from('scratch_card_plays')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('consumer_phone', consumerPhone)
        .gte('played_at', `${today}T00:00:00`)
        .lte('played_at', `${today}T23:59:59`)

    if (playsError) {
        return NextResponse.json({ error: 'Error checking limits' }, { status: 500 })
    }

    if (campaign.max_plays_per_day && (playsToday || 0) >= campaign.max_plays_per_day) {
        return NextResponse.json({ error: 'Daily limit reached', code: 'DAILY_LIMIT_REACHED' }, { status: 403 })
    }

    // Max plays total per consumer
    if (campaign.max_plays_total_per_consumer) {
        const { count: playsTotal } = await supabase
            .from('scratch_card_plays')
            .select('*', { count: 'exact', head: true })
            .eq('campaign_id', campaignId)
            .eq('consumer_phone', consumerPhone)
        
        if ((playsTotal || 0) >= campaign.max_plays_total_per_consumer) {
            return NextResponse.json({ error: 'Total limit reached', code: 'TOTAL_LIMIT_REACHED' }, { status: 403 })
        }
    }

    // 3. Select Reward
    const { data: rewards } = await supabase
        .from('scratch_card_rewards')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('is_active', true)

    if (!rewards || rewards.length === 0) {
        return NextResponse.json({ error: 'No rewards configured' }, { status: 500 })
    }

    // Weighted random selection
    let selectedReward = null
    const random = Math.random() * 100
    let cumulativeProbability = 0

    for (const reward of rewards) {
        cumulativeProbability += reward.probability
        if (random <= cumulativeProbability) {
            selectedReward = reward
            break
        }
    }

    // Fallback to no prize if something goes wrong or probability doesn't sum to 100 (and random > sum)
    if (!selectedReward) {
        selectedReward = rewards.find(r => r.type === 'no_prize') || rewards[0]
    }

    // Check reward limits (max winners)
    if (selectedReward.max_winners || selectedReward.max_winners_per_day) {
        // Check if limit reached, if so, fallback to no_prize
        
        let limitReached = false
        if (selectedReward.max_winners) {
            const { count: totalWinners } = await supabase
                .from('scratch_card_plays')
                .select('*', { count: 'exact', head: true })
                .eq('reward_id', selectedReward.id)
            
            if ((totalWinners || 0) >= selectedReward.max_winners) limitReached = true
        }

        if (!limitReached && selectedReward.max_winners_per_day) {
            const { count: dailyWinners } = await supabase
                .from('scratch_card_plays')
                .select('*', { count: 'exact', head: true })
                .eq('reward_id', selectedReward.id)
                .gte('played_at', `${today}T00:00:00`)
            
            if ((dailyWinners || 0) >= selectedReward.max_winners_per_day) limitReached = true
        }

        if (limitReached) {
            // Find a no_prize reward or create a dummy one
            const noPrize = rewards.find(r => r.type === 'no_prize')
            if (noPrize) {
                selectedReward = noPrize
            } else {
                // If no "no_prize" configured, just return a generic no win
                selectedReward = { id: null, type: 'no_prize', name: 'Better luck next time!' }
            }
        }
    }

    const isWin = selectedReward.type !== 'no_prize'

    // 4. Record Play
    const { error: insertError } = await supabase
        .from('scratch_card_plays')
        .insert({
            campaign_id: campaignId,
            qr_code_id: qrCodeId || null,
            consumer_phone: consumerPhone,
            consumer_name: consumerName,
            reward_id: selectedReward.id, // Can be null if dummy no_prize
            is_win: isWin
        })

    if (insertError) {
        console.error('Error recording play:', insertError)
        return NextResponse.json({ error: 'Failed to record play' }, { status: 500 })
    }

    return NextResponse.json({
        result: isWin ? 'win' : 'no_prize',
        reward: {
            name: selectedReward.name,
            type: selectedReward.type,
            value: selectedReward.value_points || selectedReward.external_link || null,
            product_id: selectedReward.product_id
        },
        message: isWin ? (campaign.theme_config?.success_message || 'You won!').replace('{{reward_name}}', selectedReward.name) : (campaign.theme_config?.no_prize_message || 'Better luck next time!')
    })
}
