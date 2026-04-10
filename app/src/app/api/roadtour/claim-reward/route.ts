import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { token, shop_id, consumer_phone, consumer_name, survey_answers, geolocation, login_email, login_password } = body

        if (!token) {
            return NextResponse.json({ message: 'Missing QR token.' }, { status: 400 })
        }

        const supabase = createAdminClient()

        // 1. Validate QR token (function created by migration, cast to bypass type generation lag)
        const { data: validation, error: valError } = await (supabase as any).rpc('validate_roadtour_qr_token', { p_token: token })
        if (valError || !validation || validation.valid === false) {
            const msg = validation?.message || valError?.message || 'Invalid QR code.'
            const code = validation?.error === 'expired' ? 'EXPIRED' : 'INVALID'
            return NextResponse.json({ message: msg, code }, { status: 400 })
        }

        const {
            qr_code_id, campaign_id, account_manager_user_id,
            default_points, reward_mode, survey_template_id, org_id,
            duplicate_rule_reward
        } = validation as any

        // Use QR code's built-in shop_id as fallback (the QR knows which shop/location it belongs to)
        const resolved_shop_id = shop_id || (validation as any).shop_id || null

        // 2. Resolve authenticated user
        let userId: string | null = null
        let userPhone: string | null = consumer_phone || null

        // Try session-based auth first
        try {
            const serverSupabase = await createClient()
            const { data: { user } } = await serverSupabase.auth.getUser()
            if (user) {
                userId = user.id
                const { data: profile } = await supabase.from('users').select('phone, full_name').eq('id', user.id).single()
                if (profile?.phone) userPhone = profile.phone
            }
        } catch { /* no session, continue */ }

        // Try login with email/password if provided
        if (!userId && login_email && login_password) {
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email: login_email,
                password: login_password,
            })
            if (authError) {
                return NextResponse.json({ message: authError.message || 'Invalid credentials.', code: 'AUTH_FAILED' }, { status: 401 })
            }
            if (authData?.user) {
                userId = authData.user.id
                const { data: profile } = await supabase.from('users').select('phone, full_name').eq('id', authData.user.id).single()
                if (profile?.phone) userPhone = profile.phone
            }
        }

        // 2b. Profile completion gate — same check as product collect-points flow
        // Independent/no-org consumers must have shop_name + referral_phone filled
        if (userId) {
            const { data: userProfile } = await (supabase as any)
                .from('users')
                .select('shop_name, referral_phone, organization_id, organizations!fk_users_organization(org_type_code)')
                .eq('id', userId)
                .single()

            if (userProfile) {
                const orgType = (userProfile.organizations as any)?.org_type_code
                const needsProfile = (!orgType || orgType === 'INDEP') &&
                    (!userProfile.shop_name?.trim() || !userProfile.referral_phone?.trim())

                if (needsProfile) {
                    const missing: string[] = []
                    if (!userProfile.shop_name?.trim()) missing.push('Shop Name')
                    if (!userProfile.referral_phone?.trim()) missing.push('Reference')
                    return NextResponse.json(
                        {
                            requiresProfileUpdate: true,
                            message: `Please update your ${missing.join(' and ')} in Profile before collecting points.`,
                            code: 'PROFILE_INCOMPLETE',
                            missing,
                        },
                        { status: 400 }
                    )
                }
            }
        }

        // 2c. Shop context gate — use QR's shop_id when user didn't provide one
        const require_shop_context = (validation as any).require_shop_context
        if (require_shop_context && !resolved_shop_id) {
            return NextResponse.json(
                { message: 'Please select the shop you are visiting.', code: 'SHOP_REQUIRED' },
                { status: 400 }
            )
        }

        // 2d. Survey gate — if campaign requires survey and none submitted
        if (reward_mode === 'survey_submit' && survey_template_id && !survey_answers) {
            return NextResponse.json(
                { message: 'Please complete the survey to claim your reward.', code: 'SURVEY_REQUIRED' },
                { status: 400 }
            )
        }

        // 3. Record scan event with geolocation
        const { data: scanEvent, error: scanError } = await (supabase as any)
            .from('roadtour_scan_events')
            .insert({
                campaign_id,
                qr_code_id,
                account_manager_user_id,
                scanned_by_user_id: userId || null,
                consumer_phone: userPhone || null,
                shop_id: resolved_shop_id,
                scan_status: 'opened',
                geolocation: geolocation || null,
            })
            .select('id')
            .single()

        if (scanError) {
            return NextResponse.json({ message: 'Failed to record scan.', detail: scanError.message }, { status: 500 })
        }

        // 4. If survey mode, save survey response
        let surveyResponseId: string | null = null
        if (reward_mode === 'survey_submit' && survey_template_id && survey_answers) {
            const { data: surveyResp, error: surveyErr } = await (supabase as any)
                .from('roadtour_survey_responses')
                .insert({
                    scan_event_id: scanEvent.id,
                    template_id: survey_template_id,
                })
                .select('id')
                .single()

            if (surveyErr) {
                return NextResponse.json({ message: 'Failed to save survey.', detail: surveyErr.message }, { status: 500 })
            }

            surveyResponseId = surveyResp.id

            // Save individual answers
            const items = Object.entries(survey_answers).map(([field_key, value]) => ({
                response_id: surveyResp.id,
                field_key,
                value: String(value),
            }))

            if (items.length > 0) {
                const { error: itemsErr } = await (supabase as any).from('roadtour_survey_response_items').insert(items)
                if (itemsErr) {
                    console.error('Failed to save survey items:', itemsErr)
                }
            }
        }

        // 5. Record reward using the DB function
        const { data: rewardResult, error: rewardError } = await (supabase as any).rpc('record_roadtour_reward', {
            p_org_id: org_id,
            p_campaign_id: campaign_id,
            p_qr_code_id: qr_code_id,
            p_account_manager_user_id: account_manager_user_id,
            p_scanned_by_user_id: userId || null,
            p_shop_id: resolved_shop_id,
            p_points: default_points,
            p_scan_event_id: scanEvent.id,
            p_survey_response_id: surveyResponseId,
            p_duplicate_rule: duplicate_rule_reward || 'one_per_user_per_campaign',
            p_transaction_type: reward_mode === 'survey_submit' ? 'roadtour_survey' : 'roadtour',
        })

        if (rewardError) {
            // Check for duplicate
            if (rewardError.message?.includes('duplicate') || rewardError.code === '23505') {
                await (supabase as any).from('roadtour_scan_events').update({ scan_status: 'duplicate' }).eq('id', scanEvent.id)
                return NextResponse.json({ message: 'You have already claimed this reward.', code: 'DUPLICATE' }, { status: 409 })
            }
            return NextResponse.json({ message: rewardError.message || 'Reward processing failed.', code: 'ERROR' }, { status: 500 })
        }

        // Check if rewardResult indicates duplicate
        if (rewardResult && rewardResult.success === false && rewardResult.error === 'duplicate') {
            await (supabase as any).from('roadtour_scan_events').update({ scan_status: 'duplicate' }).eq('id', scanEvent.id)
            return NextResponse.json({ message: rewardResult.message || 'You have already claimed this reward.', code: 'DUPLICATE' }, { status: 409 })
        }

        return NextResponse.json({
            message: 'Reward claimed successfully.',
            points_awarded: default_points,
            balance_after: rewardResult?.balance_after || default_points,
            scan_event_id: scanEvent.id,
            survey_response_id: surveyResponseId,
        })
    } catch (err: any) {
        console.error('RoadTour claim-reward error:', err)
        return NextResponse.json({ message: 'Internal server error.' }, { status: 500 })
    }
}
