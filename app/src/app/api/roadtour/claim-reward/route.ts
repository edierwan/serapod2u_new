import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getRoadtourGeoLabel, reverseGeocodeRoadtourLocation } from '@/lib/roadtour/geolocation'
import { sendRoadtourClaimNotifications } from '@/lib/roadtour/notifications'
import { resolveRoadtourByToken } from '@/lib/roadtour/server'

function isMissingConsumerPhoneColumnError(error: any) {
    const combined = [error?.message, error?.details, error?.hint]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

    return combined.includes('consumer_phone') && (
        combined.includes('column') ||
        combined.includes('schema cache') ||
        error?.code === 'PGRST204' ||
        error?.code === '42703'
    )
}

function isMissingGeoLocColumnError(error: any) {
    const combined = [error?.message, error?.details, error?.hint]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

    return ['geo_label', 'geo_city', 'geo_state', 'geo_country', 'geo_full_address']
        .some((column) => combined.includes(column) && (
            combined.includes('column') ||
            combined.includes('schema cache') ||
            error?.code === 'PGRST204' ||
            error?.code === '42703'
        ))
}

function buildScanInsertErrorPayload(error: any) {
    if (isMissingConsumerPhoneColumnError(error)) {
        return {
            message: 'RoadTour scan setup is outdated on the server. The scan record schema is missing the consumer phone field.',
            issue: 'missing_consumer_phone_column',
            detail: error?.message || null,
            hint: error?.hint || 'Apply migration 20260412_roadtour_scan_consumer_phone.sql and refresh PostgREST schema cache.',
            code: 'SCAN_SCHEMA_MISMATCH',
        }
    }

    return {
        message: error?.message || 'Failed to record RoadTour scan event.',
        issue: 'scan_insert_failed',
        detail: error?.details || null,
        hint: error?.hint || null,
        code: error?.code || 'SCAN_RECORD_FAILED',
    }
}

function isMissingRoadtourBalanceGuardError(error: any) {
    const combined = [error?.message, error?.details, error?.hint]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

    return combined.includes('balance_after') && combined.includes('not-null')
}

function buildRewardErrorPayload(error: any) {
    if (isMissingRoadtourBalanceGuardError(error)) {
        return {
            message: 'RoadTour reward setup is outdated on the server. The reward function is missing the balance fallback fix for first-time claimers.',
            issue: 'missing_roadtour_balance_guard',
            detail: error?.message || null,
            hint: 'Apply migration 20260413_fix_roadtour_reward_balance_null.sql and refresh PostgREST schema cache.',
            code: 'REWARD_SCHEMA_MISMATCH',
        }
    }

    return {
        message: error?.message || 'Reward processing failed.',
        issue: 'reward_processing_failed',
        detail: error?.details || null,
        hint: error?.hint || null,
        code: error?.code || 'ERROR',
    }
}

async function calculateRoadtourUserBalance(supabase: any, userId: string | null) {
    if (!userId) return 0

    const { data: consumerBalance, error: consumerBalanceError } = await supabase
        .from('v_consumer_points_balance')
        .select('current_balance')
        .eq('user_id', userId)
        .maybeSingle()

    if (!consumerBalanceError && consumerBalance?.current_balance !== undefined && consumerBalance?.current_balance !== null) {
        return Number(consumerBalance.current_balance || 0)
    }

    const { data: ledgerRows, error: ledgerError } = await supabase
        .from('shop_points_ledger')
        .select('points_change')
        .eq('consumer_id', userId)

    if (!ledgerError && ledgerRows && ledgerRows.length > 0) {
        return ledgerRows.reduce((sum: number, row: any) => sum + Number(row.points_change || 0), 0)
    }

    const { data: scanRows, error: scanError } = await supabase
        .from('consumer_qr_scans')
        .select('points_amount')
        .eq('consumer_id', userId)
        .eq('collected_points', true)

    if (!scanError && scanRows && scanRows.length > 0) {
        return scanRows.reduce((sum: number, row: any) => sum + Number(row.points_amount || 0), 0)
    }

    return 0
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { token, shop_id, consumer_phone, consumer_name, survey_answers, geolocation, login_email, login_password } = body
        const roadtourShopOnlyMessage = 'This Road Tour Bonus is for Shop ID, Please update your profile to claim the bonus'

        if (!token) {
            return NextResponse.json({ message: 'Missing QR token.' }, { status: 400 })
        }

        const supabase = createAdminClient()

        async function notifyClaim(params: {
            scanEventId?: string | null
            campaignId: string
            qrCodeId?: string | null
            accountManagerUserId?: string | null
            notificationType: 'success' | 'failed' | 'duplicate'
            campaignName: string
            referenceName?: string | null
            shopName?: string | null
            consumerName?: string | null
            pointsAwarded?: number | null
            balanceAfter?: number | null
            canonicalPath?: string | null
            geoLabel?: string | null
            message: string
        }) {
            try {
                await sendRoadtourClaimNotifications({
                    supabase,
                    orgId: org_id,
                    ...params,
                })
            } catch (notificationError) {
                console.error('[RT] claim notification failed:', notificationError)
            }
        }

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
        const qrRecord = await resolveRoadtourByToken(token)
        const campaignName = (validation as any).campaign_name || qrRecord?.campaign_name || 'RoadTour'
        const referenceName = (validation as any).account_manager_name || qrRecord?.account_manager_name || 'Reference'
        const resolvedGeoLocation = await reverseGeocodeRoadtourLocation(geolocation)
        const resolvedGeoLabel = getRoadtourGeoLabel(resolvedGeoLocation, Boolean(geolocation))

        // 2. Resolve authenticated user
        let userId: string | null = null
        let userPhone: string | null = consumer_phone || null
        let userProfile: any = null

        console.log('[RT] claim-reward called, token:', token?.substring(0, 8), 'login_email:', login_email || 'none')

        // Try session-based auth first
        try {
            const serverSupabase = await createClient()
            const { data: { user }, error: userError } = await serverSupabase.auth.getUser()
            console.log('[RT] session auth:', user ? `userId=${user.id}` : 'no user', userError ? `error=${userError.message}` : '')
            if (user) {
                userId = user.id
            }
        } catch (e: any) {
            console.log('[RT] session auth exception:', e?.message || 'unknown')
        }

        // Try login with email/password if provided — use a SEPARATE anon client
        // to avoid clobbering the admin client's service_role session.
        if (!userId && login_email && login_password) {
            console.log('[RT] trying email/password login for:', login_email)
            const anonClient = createSupabaseClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
                { auth: { autoRefreshToken: false, persistSession: false } }
            )
            const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
                email: login_email,
                password: login_password,
            })
            if (authError) {
                console.log('[RT] signInWithPassword failed:', authError.message)
                return NextResponse.json({ message: authError.message || 'Invalid credentials.', code: 'AUTH_FAILED' }, { status: 401 })
            }
            if (authData?.user) {
                userId = authData.user.id
                console.log('[RT] email/password login OK, userId:', userId)
            }
        }

        if (userId) {
            const { data: profile, error: profileError } = await (supabase as any)
                .from('users')
                .select('phone, full_name, shop_name, referral_phone, organization_id, organizations!fk_users_organization(org_type_code, org_name)')
                .eq('id', userId)
                .single()

            userProfile = profile || null
            if (userProfile?.phone) userPhone = userProfile.phone
            console.log('[RT] profile:', userProfile ? `org=${userProfile.organization_id}, orgType=${userProfile.organizations?.org_type_code}, shop=${userProfile.shop_name}` : 'null', profileError ? `err=${profileError.message}` : '')
        }

        const orgType = userProfile?.organizations?.org_type_code || null
        const duplicateShopName = userProfile?.organizations?.org_name?.trim() || userProfile?.shop_name?.trim() || 'shop'
        const consumerDisplayName = userProfile?.full_name?.trim() || consumer_name?.trim() || userPhone || 'Unknown consumer'
        const hasShopProfile = Boolean(userProfile?.shop_name?.trim() && userProfile?.referral_phone?.trim())
        const isShopUser = orgType === 'SHOP'
        const isConsumerLaneUser = !orgType || orgType === 'INDEP'

        const qrShopId = (validation as any).shop_id || null
        const explicitShopId = shop_id || null
        const resolvedScanShopId = explicitShopId || qrShopId
        // Use authenticated SHOP organization only for reward context and duplicate rules.
        const resolvedRewardShopId = resolvedScanShopId || (isShopUser ? userProfile?.organization_id || null : null)

        // 2b. Profile completion gate — same check as product collect-points flow
        // Independent/no-org consumers must have shop_name + referral_phone filled
        if (userId && userProfile) {
            if (isConsumerLaneUser && !hasShopProfile) {
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

            if (!isShopUser) {
                return NextResponse.json(
                    {
                        requiresProfileUpdate: true,
                        message: roadtourShopOnlyMessage,
                        code: 'SHOP_REQUIRED',
                    },
                    { status: 400 }
                )
            }
        }

        // 2c. Shop context gate — use QR's shop_id when user didn't provide one
        const require_shop_context = (validation as any).require_shop_context
        if (require_shop_context && !resolvedRewardShopId) {
            return NextResponse.json(
                {
                    requiresProfileUpdate: true,
                    message: roadtourShopOnlyMessage,
                    code: 'SHOP_REQUIRED',
                },
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
        console.log('[RT] inserting scan event:', { campaign_id, qr_code_id, account_manager_user_id, userId, resolvedScanShopId })

        const scanInsertPayload = {
            campaign_id,
            qr_code_id,
            account_manager_user_id,
            scanned_by_user_id: userId || null,
            consumer_phone: userPhone || null,
            shop_id: resolvedScanShopId,
            scan_status: 'opened',
            geolocation: geolocation || null,
            geo_label: resolvedGeoLabel,
            geo_city: resolvedGeoLocation.geo_city,
            geo_state: resolvedGeoLocation.geo_state,
            geo_country: resolvedGeoLocation.geo_country,
            geo_full_address: resolvedGeoLocation.geo_full_address,
        }

        let { data: scanEvent, error: scanError } = await (supabase as any)
            .from('roadtour_scan_events')
            .insert(scanInsertPayload)
            .select('id')
            .single()

        if (scanError && (isMissingConsumerPhoneColumnError(scanError) || isMissingGeoLocColumnError(scanError))) {
            console.warn('[RT] retrying scan event insert without optional schema-drift fields')

            const {
                consumer_phone: _consumerPhone,
                geo_label: _geoLabel,
                geo_city: _geoCity,
                geo_state: _geoState,
                geo_country: _geoCountry,
                geo_full_address: _geoFullAddress,
                ...fallbackScanInsertPayload
            } = scanInsertPayload

            const fallbackResult = await (supabase as any)
                .from('roadtour_scan_events')
                .insert(fallbackScanInsertPayload)
                .select('id')
                .single()

            scanEvent = fallbackResult.data
            scanError = fallbackResult.error
        }

        if (scanError) {
            console.error('[RT] scan event insert FAILED:', JSON.stringify({
                message: scanError.message,
                code: scanError.code,
                details: scanError.details,
                hint: scanError.hint,
                campaign_id,
                qr_code_id,
                account_manager_user_id,
                scanned_by_user_id: userId || null,
                scan_shop_id: resolvedScanShopId,
                reward_shop_id: resolvedRewardShopId,
            }))
            return NextResponse.json(buildScanInsertErrorPayload(scanError), { status: 500 })
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
            p_shop_id: resolvedRewardShopId,
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
                await notifyClaim({
                    scanEventId: scanEvent.id,
                    campaignId: campaign_id,
                    qrCodeId: qr_code_id,
                    accountManagerUserId: account_manager_user_id,
                    notificationType: 'duplicate',
                    campaignName,
                    referenceName,
                    shopName: duplicateShopName,
                    consumerName: consumerDisplayName,
                    canonicalPath: qrRecord?.canonical_path || null,
                    geoLabel: resolvedGeoLabel,
                    message: `Your ${duplicateShopName} have already claimed the reward for this Road Tour campaign.`,
                })
                return NextResponse.json({ message: `Your ${duplicateShopName} have already claimed the reward for this Road Tour campaign.`, code: 'DUPLICATE' }, { status: 409 })
            }
            await notifyClaim({
                scanEventId: scanEvent.id,
                campaignId: campaign_id,
                qrCodeId: qr_code_id,
                accountManagerUserId: account_manager_user_id,
                notificationType: 'failed',
                campaignName,
                referenceName,
                shopName: duplicateShopName,
                consumerName: consumerDisplayName,
                canonicalPath: qrRecord?.canonical_path || null,
                geoLabel: resolvedGeoLabel,
                message: rewardError.message || 'Reward processing failed.',
            })
            return NextResponse.json(buildRewardErrorPayload(rewardError), { status: 500 })
        }

        // Check if rewardResult indicates duplicate
        if (rewardResult && rewardResult.success === false && rewardResult.error === 'duplicate') {
            await (supabase as any).from('roadtour_scan_events').update({ scan_status: 'duplicate' }).eq('id', scanEvent.id)
            await notifyClaim({
                scanEventId: scanEvent.id,
                campaignId: campaign_id,
                qrCodeId: qr_code_id,
                accountManagerUserId: account_manager_user_id,
                notificationType: 'duplicate',
                campaignName,
                referenceName,
                shopName: duplicateShopName,
                consumerName: consumerDisplayName,
                canonicalPath: qrRecord?.canonical_path || null,
                geoLabel: resolvedGeoLabel,
                message: `Your ${duplicateShopName} have already claimed the reward for this Road Tour campaign.`,
            })
            return NextResponse.json({ message: `Your ${duplicateShopName} have already claimed the reward for this Road Tour campaign.`, code: 'DUPLICATE' }, { status: 409 })
        }

        const totalBalance = await calculateRoadtourUserBalance(supabase, userId)

        await notifyClaim({
            scanEventId: scanEvent.id,
            campaignId: campaign_id,
            qrCodeId: qr_code_id,
            accountManagerUserId: account_manager_user_id,
            notificationType: 'success',
            campaignName,
            referenceName,
            shopName: duplicateShopName,
            consumerName: consumerDisplayName,
            pointsAwarded: default_points,
            balanceAfter: totalBalance,
            canonicalPath: qrRecord?.canonical_path || null,
            geoLabel: resolvedGeoLabel,
            message: 'Reward claimed successfully.',
        })

        return NextResponse.json({
            message: 'Reward claimed successfully.',
            points_awarded: default_points,
            balance_after: totalBalance,
            total_balance: totalBalance,
            scan_event_id: scanEvent.id,
            survey_response_id: surveyResponseId,
        })
    } catch (err: any) {
        console.error('[RT] claim-reward EXCEPTION:', err?.message, err?.stack?.substring(0, 300))
        return NextResponse.json({ message: 'Internal server error.', detail: err?.message }, { status: 500 })
    }
}
