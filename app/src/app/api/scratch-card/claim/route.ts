import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { Database } from '@/types/database'

export async function POST(request: Request) {
    // Use service role key to bypass RLS for claim verification and data operations
    const supabaseAdmin = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        }
    )

    // Public client for authenticating shop credentials
    const supabaseAuth = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        }
    )

    const body = await request.json()
    const { playId, rewardType, shopId, password, name, phone, email } = body

    if (!playId || !rewardType) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    try {
        // 1. Verify the play exists and is a win
        const { data: play, error: playError } = await supabaseAdmin
            .from('scratch_card_plays')
            .select('*, scratch_card_rewards(*)')
            .eq('id', playId)
            .single()

        if (playError || !play) {
            return NextResponse.json({ error: 'Invalid play record' }, { status: 400 })
        }

        if (!play.is_win) {
            return NextResponse.json({ error: 'This play was not a win' }, { status: 400 })
        }

        if (play.is_claimed) {
            return NextResponse.json({ error: 'Prize already claimed' }, { status: 400 })
        }

        // 2. Handle Points Claim
        if (rewardType === 'points') {
            if (!shopId || !password) {
                return NextResponse.json({ error: 'Shop ID and Password required' }, { status: 400 })
            }

            // --- AUTHENTICATION LOGIC START ---
            let emailToAuth = shopId

            // Check if shop_id is a phone number (simple check: doesn't contain @)
            if (!shopId.includes('@')) {
                // Lookup user by phone number using admin client
                const { data: userByPhone, error: phoneError } = await supabaseAdmin
                    .from('users')
                    .select('email')
                    .eq('phone', shopId)
                    .single()
                
                if (phoneError || !userByPhone) {
                    return NextResponse.json({ error: 'Invalid shop ID or password' }, { status: 401 })
                }
                emailToAuth = userByPhone.email
            }

            // Try to sign in with Supabase Auth
            const { data: authData, error: signInError } = await supabaseAuth.auth.signInWithPassword({
                email: emailToAuth,
                password: password
            })

            if (signInError || !authData.user) {
                return NextResponse.json({ error: 'Invalid shop ID or password' }, { status: 401 })
            }

            // Get shop user profile with organization details
            const { data: shopUser, error: profileError } = await supabaseAdmin
                .from('users')
                .select(`
                    id, 
                    organization_id, 
                    organizations!fk_users_organization(
                        id,
                        org_type_code,
                        org_name
                    )
                `)
                .eq('id', authData.user.id)
                .single()

            if (profileError || !shopUser || !shopUser.organization_id) {
                return NextResponse.json({ error: 'User profile or organization not found.' }, { status: 403 })
            }
            
            const organizationId = shopUser.organization_id
            // --- AUTHENTICATION LOGIC END ---

            const { error: updateError } = await supabaseAdmin
                .from('scratch_card_plays')
                .update({
                    is_claimed: true,
                    claimed_at: new Date().toISOString(),
                    shop_id: organizationId,
                    claim_details: { shopId, method: 'shop_login', auth_user_id: authData.user.id }
                })
                .eq('id', playId)

            if (updateError) throw updateError

            // Add points transaction
            // @ts-ignore - Supabase types might not infer the join correctly
            const reward = play.scratch_card_rewards
            const rewardPoints = reward?.value_points || 0
            
            if (rewardPoints > 0) {
                // 1. Get current balance
                const { data: balanceData } = await supabaseAdmin
                    .from('v_shop_points_balance')
                    .select('current_balance')
                    .eq('shop_id', organizationId)
                    .maybeSingle()
                
                const currentBalance = balanceData?.current_balance || 0
                const newBalance = currentBalance + rewardPoints

                // 2. Insert transaction
                const { error: txnError } = await supabaseAdmin
                    .from('points_transactions')
                    .insert({
                        company_id: organizationId,
                        consumer_phone: play.consumer_phone || 'UNKNOWN',
                        consumer_email: play.consumer_email,
                        transaction_type: 'adjust', // Changed from 'scratch_reward' to 'adjust' to satisfy check constraint
                        points_amount: rewardPoints,
                        balance_after: newBalance,
                        qr_code_id: play.qr_code_id,
                        description: `Won from Scratch Card: ${reward?.name || 'Reward'}`,
                        transaction_date: new Date().toISOString()
                    })

                if (txnError) {
                    console.error('Failed to add points transaction:', txnError)
                    throw new Error('Failed to credit points: ' + txnError.message)
                }

                return NextResponse.json({ 
                    success: true, 
                    points_earned: rewardPoints, 
                    new_balance: newBalance 
                })
            }

            return NextResponse.json({ success: true })

        } else {
            // 3. Handle Product/Other Claim
            if (!name || !phone) {
                return NextResponse.json({ error: 'Name and Phone required' }, { status: 400 })
            }

            const { error: updateError } = await supabaseAdmin
                .from('scratch_card_plays')
                .update({
                    is_claimed: true,
                    claimed_at: new Date().toISOString(),
                    consumer_name: name,
                    consumer_phone: phone,
                    consumer_email: email,
                    claim_details: { name, phone, email, method: 'consumer_form' }
                })
                .eq('id', playId)

            if (updateError) throw updateError
        }

        return NextResponse.json({ success: true })

    } catch (e: any) {
        console.error('Claim Error:', e)
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 })
    }
}
