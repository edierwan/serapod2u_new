import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    const supabase = await createClient()
    
    try {
        const body = await request.json()
        let { campaign_id, qr_code_id, qr_code, consumer_phone, consumer_name } = body

        if (!campaign_id) {
            return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
        }

        // Resolve QR Code ID if only code string is provided
        if (!qr_code_id && qr_code) {
            const { data: qrData } = await supabase
                .from('qr_codes')
                .select('id')
                .eq('code', qr_code)
                .single()
            
            if (qrData) {
                qr_code_id = qrData.id
            }
        }

        // 1. Fetch Campaign
        const { data: campaign, error: campaignError } = await supabase
            .from('spin_wheel_campaigns')
            .select('*')
            .eq('id', campaign_id)
            .single()

        if (campaignError || !campaign) {
            return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
        }

        if (campaign.status !== 'active') {
            return NextResponse.json({ error: 'Campaign is not active' }, { status: 400 })
        }

        // 2. Check Limits (Simplified for now, assuming basic checks pass)
        // In a real scenario, we'd check daily limits, total limits, etc.
        
        // 3. Fetch Rewards
        const { data: rewards, error: rewardsError } = await supabase
            .from('spin_wheel_rewards')
            .select('*')
            .eq('campaign_id', campaign_id)
            .eq('is_active', true)

        if (rewardsError || !rewards || rewards.length === 0) {
            return NextResponse.json({ error: 'No rewards configured' }, { status: 400 })
        }

        // 4. Calculate Winner
        // Filter rewards that have stock remaining
        const availableRewards = rewards.filter(r => {
            // If it's unlimited (like points with no limit, though schema has quantity_remaining), 
            // or has quantity > 0
            // For now, assume all rewards track quantity except maybe 'no_prize' if we handle it specially
            // But usually 'no_prize' is just a reward with type 'no_prize'
            return (r.quantity_remaining === null || r.quantity_remaining > 0)
        })

        // Calculate total probability of available rewards
        // Note: If probabilities don't sum to 100, we normalize or handle "no prize" as fallback
        // Here we use a simple weighted random
        
        let totalWeight = 0
        const weightedRewards = availableRewards.map(r => {
            // Use probability field (float)
            // If probability is 0, it can't be won unless it's the only option?
            const weight = r.probability || 0
            totalWeight += weight
            return { ...r, weight }
        })

        // If total weight is 0 (e.g. all stock ran out), force "no prize" or error
        // We should ideally have a "No Prize" fallback in the DB or logic
        
        let selectedReward = null
        
        if (totalWeight > 0) {
            const random = Math.random() * totalWeight
            let cursor = 0
            for (const reward of weightedRewards) {
                cursor += reward.weight
                if (random <= cursor) {
                    selectedReward = reward
                    break
                }
            }
        }

        // Fallback if nothing selected (shouldn't happen if logic is correct and totalWeight > 0)
        if (!selectedReward) {
            // Try to find a "no_prize" type reward
            selectedReward = rewards.find(r => r.type === 'no_prize')
        }

        if (!selectedReward) {
             return NextResponse.json({ error: 'No valid reward available' }, { status: 400 })
        }

        // 5. Record Play
        const isWin = selectedReward.type !== 'no_prize'
        
        const { data: play, error: playError } = await supabase
            .from('spin_wheel_plays')
            .insert({
                campaign_id,
                qr_code_id: qr_code_id || null,
                consumer_phone: consumer_phone || null,
                consumer_name: consumer_name || null,
                reward_id: selectedReward.id,
                is_win: isWin
            })
            .select()
            .single()

        if (playError) {
            console.error('Play record error:', playError)
            return NextResponse.json({ error: 'Failed to record play' }, { status: 500 })
        }

        // 6. Decrement Stock
        if (selectedReward.quantity_remaining !== null) {
            await supabase
                .from('spin_wheel_rewards')
                .update({ quantity_remaining: selectedReward.quantity_remaining - 1 })
                .eq('id', selectedReward.id)
        }

        // 7. Award Points (if applicable)
        if (isWin && selectedReward.type === 'points' && selectedReward.value_points && qr_code_id) {
            // Call RPC or update points directly
            // Assuming there's a mechanism to add points to a consumer or QR code
            // For now, we just return the result and let the frontend show it
            // In a full implementation, we'd update the consumer's point balance here
        }

        return NextResponse.json({
            success: true,
            reward: selectedReward,
            play_id: play.id
        })

    } catch (error: any) {
        console.error('Spin API Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
