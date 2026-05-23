import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { normalizePointClaimSettings, resolveClaimLaneExperience } from '@/lib/engagement/point-claim-settings'
import { resolveCollectProfileCompletion, getIncompleteProfileMessage } from '@/lib/engagement/profile-completion'
import { resolveProfileLinkValidation } from '@/lib/engagement/profile-link-validation'
import {
    getRoadtourDuplicateResponse,
    isSameRoadtourParticipantPhone,
    normalizeRoadtourParticipantPhone,
} from '@/lib/roadtour/duplicate-protection'
import { getRoadtourGeoLabel, getRoadtourLocationError, getRoadtourLocationStatus, normalizeRoadtourGeolocationInput, reverseGeocodeRoadtourLocation } from '@/lib/roadtour/geolocation'
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

    return ['geo_label', 'geo_city', 'geo_state', 'geo_country', 'geo_full_address', 'latitude', 'longitude', 'accuracy_m', 'geo_source', 'geo_payload', 'location_status', 'location_error', 'location_captured_at', 'geo_resolved_at']
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

type RoadtourSurveyFieldMeta = {
    field_key: string
    field_label: string | null
    field_type: string | null
}

type RoadtourSurveyResponseItemInsert = {
    field_key: string
    field_label_snapshot: string | null
    field_type_snapshot: string | null
    answer_text?: string | null
    answer_json?: unknown
    answer_number?: number
    media_url?: string | null
}

function buildRoadtourSurveyResponseItem(params: {
    fieldKey: string
    field: RoadtourSurveyFieldMeta | undefined
    rawValue: unknown
}): RoadtourSurveyResponseItemInsert | null {
    const { fieldKey, field, rawValue } = params
    const fieldType = field?.field_type || null
    const baseItem = {
        field_key: fieldKey,
        field_label_snapshot: field?.field_label || null,
        field_type_snapshot: fieldType,
    }

    if (rawValue === null || rawValue === undefined) {
        return null
    }

    if (Array.isArray(rawValue)) {
        const values = rawValue.map((value) => String(value).trim()).filter(Boolean)
        if (values.length === 0) return null
        return { ...baseItem, answer_json: values }
    }

    if (typeof rawValue === 'boolean') {
        return { ...baseItem, answer_json: rawValue }
    }

    if (typeof rawValue === 'number') {
        if (!Number.isFinite(rawValue)) return null
        return { ...baseItem, answer_number: rawValue }
    }

    if (typeof rawValue === 'object') {
        const entries = Object.entries(rawValue)
        if (entries.length === 0) return null
        return { ...baseItem, answer_json: rawValue }
    }

    const normalizedText = String(rawValue).trim()
    if (!normalizedText) {
        return null
    }

    if (fieldType === 'number') {
        const parsedNumber = Number(normalizedText)
        if (!Number.isNaN(parsedNumber)) {
            return { ...baseItem, answer_number: parsedNumber }
        }
    }

    if (fieldType === 'multi_select') {
        const values = normalizedText.split(',').map((value) => value.trim()).filter(Boolean)
        if (values.length === 0) return null
        return { ...baseItem, answer_json: values }
    }

    if (fieldType === 'checkbox') {
        return { ...baseItem, answer_json: normalizedText === 'true' }
    }

    if (fieldType === 'photo') {
        return { ...baseItem, media_url: normalizedText }
    }

    return { ...baseItem, answer_text: normalizedText }
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

async function hasExistingRoadtourReward(params: {
    supabase: any
    campaignId: string
    accountManagerUserId: string
    scannedByUserId: string | null
    participantPhone: string | null
    shopId: string | null
    duplicateRule: string | null
    roadtourRunId: string | null
}) {
    const {
        supabase,
        campaignId,
        accountManagerUserId,
        scannedByUserId,
        participantPhone,
        shopId,
        duplicateRule,
        roadtourRunId,
    } = params

    const hasParticipantDuplicate = async (campaignIds: string[]) => {
        if (campaignIds.length === 0) return false

        if (scannedByUserId) {
            const { data, error } = await (supabase as any)
                .from('roadtour_scan_events')
                .select('id')
                .in('campaign_id', campaignIds)
                .eq('scan_status', 'success')
                .gt('points_awarded', 0)
                .eq('scanned_by_user_id', scannedByUserId)
                .limit(1)

            if (error) throw error
            if (Array.isArray(data) && data.length > 0) return true
        }

        const normalizedParticipantPhone = normalizeRoadtourParticipantPhone(participantPhone)
        if (!normalizedParticipantPhone) return false

        const { data, error } = await (supabase as any)
            .from('roadtour_scan_events')
            .select('id, consumer_phone')
            .in('campaign_id', campaignIds)
            .eq('scan_status', 'success')
            .gt('points_awarded', 0)
            .not('consumer_phone', 'is', null)
            .limit(1000)

        if (error) throw error

        return (data || []).some((row: any) => isSameRoadtourParticipantPhone(row.consumer_phone, normalizedParticipantPhone))
    }

    if (duplicateRule === 'one_participant_once_per_event') {
        if (!roadtourRunId) return false
        const { data, error } = await (supabase as any)
            .from('roadtour_campaigns')
            .select('id')
            .eq('roadtour_run_id', roadtourRunId)

        if (error) throw error
        return hasParticipantDuplicate((data || []).map((row: any) => row.id).filter(Boolean))
    }

    if (duplicateRule === 'one_participant_once_per_campaign') {
        return hasParticipantDuplicate([campaignId])
    }

    // NEW: per RoadTour Event duplicate policy
    // Any prior official visit for the same shop under the same run blocks new rewards.
    if (duplicateRule === 'per_run' && roadtourRunId && shopId) {
        const { data, error } = await (supabase as any)
            .from('roadtour_official_visits')
            .select('id')
            .eq('roadtour_run_id', roadtourRunId)
            .eq('shop_id', shopId)
            .eq('visit_status', 'official')
            .limit(1)
        if (error) throw error
        return Array.isArray(data) && data.length > 0
    }

    if (duplicateRule === 'per_day' && roadtourRunId && shopId) {
        const utcDayStart = new Date()
        utcDayStart.setUTCHours(0, 0, 0, 0)
        const { data, error } = await (supabase as any)
            .from('roadtour_official_visits')
            .select('id')
            .eq('roadtour_run_id', roadtourRunId)
            .eq('shop_id', shopId)
            .eq('visit_status', 'official')
            .gte('created_at', utcDayStart.toISOString())
            .limit(1)
        if (error) throw error
        return Array.isArray(data) && data.length > 0
    }

    if (duplicateRule === 'none') return false

    let query = (supabase as any)
        .from('roadtour_scan_events')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('scan_status', 'success')
        .gt('points_awarded', 0)
        .limit(1)

    if (duplicateRule === 'one_per_user_per_day') {
        if (!scannedByUserId) return false
        const utcDayStart = new Date()
        utcDayStart.setUTCHours(0, 0, 0, 0)
        query = query
            .eq('scanned_by_user_id', scannedByUserId)
            .gte('scan_time', utcDayStart.toISOString())
    } else if (duplicateRule === 'one_per_shop_per_am_per_day') {
        if (!shopId) return false
        const utcDayStart = new Date()
        utcDayStart.setUTCHours(0, 0, 0, 0)
        query = query
            .eq('account_manager_user_id', accountManagerUserId)
            .eq('shop_id', shopId)
            .gte('scan_time', utcDayStart.toISOString())
    } else if (duplicateRule === 'per_campaign') {
        if (!shopId) return false
        query = query.eq('shop_id', shopId)
    } else {
        if (!scannedByUserId) return false
        query = query.eq('scanned_by_user_id', scannedByUserId)
    }

    const { data, error } = await query
    if (error) throw error

    return Array.isArray(data) && data.length > 0
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { token, shop_id, consumer_phone, consumer_name, survey_answers, geolocation, login_email, login_password, consumer_confirmation } = body

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

        // Resolve RoadTour Event (roadtour_runs) for this campaign so we can apply
        // per-event duplicate protection and snapshot the run id on downstream rows.
        let roadtour_run_id: string | null = null
        let runDuplicatePolicy: string | null = null
        let roadtourRunName: string | null = null
        try {
            const { data: campaignRow } = await (supabase as any)
                .from('roadtour_campaigns')
                .select('roadtour_run_id, roadtour_runs!roadtour_campaigns_roadtour_run_id_fkey(id,name,duplicate_policy)')
                .eq('id', campaign_id)
                .maybeSingle()
            if (campaignRow) {
                roadtour_run_id = campaignRow.roadtour_run_id || null
                const runRel: any = (campaignRow as any).roadtour_runs
                if (runRel) {
                    runDuplicatePolicy = runRel.duplicate_policy || null
                    roadtourRunName = runRel.name || null
                }
            }
        } catch (runLookupError) {
            console.warn('[RT] roadtour_run lookup skipped:', (runLookupError as any)?.message)
        }

        // Effective duplicate rule: prefer the RoadTour Event policy when available,
        // otherwise keep legacy QR/settings rule.
        const effectiveDuplicateRule = runDuplicatePolicy || duplicate_rule_reward || 'one_per_user_per_campaign'
        const { data: orgSettingsRow } = await (supabase as any)
            .from('organizations')
            .select('settings')
            .eq('id', org_id)
            .maybeSingle()
        const pointClaimSettings = normalizePointClaimSettings(orgSettingsRow?.settings, Number(default_points || 0))
        const qrRecord = await resolveRoadtourByToken(token)
        const campaignName = (validation as any).campaign_name || qrRecord?.campaign_name || 'RoadTour'
        const referenceName = (validation as any).account_manager_name || qrRecord?.account_manager_name || 'Reference'
        const normalizedGeolocation = normalizeRoadtourGeolocationInput(geolocation)
        const resolvedGeoLocation = await reverseGeocodeRoadtourLocation(normalizedGeolocation)
        const locationStatus = getRoadtourLocationStatus(normalizedGeolocation, resolvedGeoLocation)
        const resolvedGeoLabel = getRoadtourGeoLabel(resolvedGeoLocation, normalizedGeolocation)
        const locationError = getRoadtourLocationError(normalizedGeolocation, locationStatus)
        const latitude = normalizedGeolocation?.lat ?? null
        const longitude = normalizedGeolocation?.lng ?? null
        const accuracyM = normalizedGeolocation?.accuracy ?? null
        const geoSource = normalizedGeolocation?.source || (latitude !== null && longitude !== null ? 'browser' : null)
        const locationCapturedAt = normalizedGeolocation?.captured_at || normalizedGeolocation?.attempted_at || null
        const geoResolvedAt = resolvedGeoLocation.geo_resolved ? new Date().toISOString() : null

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
                .select('phone, full_name, shop_name, referral_phone, organization_id, consumer_claim_confirmed_at, organizations!fk_users_organization(org_type_code, org_name)')
                .eq('id', userId)
                .single()

            await (supabase as any)
                .from('users')
                .update({ last_login_at: new Date().toISOString() })
                .eq('id', userId)

            userProfile = profile || null
            if (userProfile?.phone) userPhone = userProfile.phone
            console.log('[RT] profile:', userProfile ? `org=${userProfile.organization_id}, orgType=${userProfile.organizations?.org_type_code}, shop=${userProfile.shop_name}` : 'null', profileError ? `err=${profileError.message}` : '')
        }

        const orgType = userProfile?.organizations?.org_type_code || null
        const duplicateShopName = userProfile?.organizations?.org_name?.trim() || null
        const consumerDisplayName = userProfile?.full_name?.trim() || consumer_name?.trim() || userPhone || null
        const duplicateMessage = consumerDisplayName && duplicateShopName
            ? `Hi ${consumerDisplayName} from ${duplicateShopName}, you have already claimed the reward for this Road Tour campaign. Thank you for being part of our RoadTour.`
            : consumerDisplayName
                ? `Hi ${consumerDisplayName}, you have already claimed the reward for this Road Tour campaign. Thank you for being part of our RoadTour.`
                : `You have already claimed the reward for this Road Tour campaign. Thank you for being part of our RoadTour.`
        const requestedClaimLane = null
        const laneExperience = resolveClaimLaneExperience({
            claimMode: pointClaimSettings.claimMode,
            organization_id: userProfile?.organization_id,
            organizationTypeCode: orgType,
            shop_name: userProfile?.shop_name,
            referral_phone: userProfile?.referral_phone,
            consumerClaimConfirmedAt: userProfile?.consumer_claim_confirmed_at,
            consumerConfirmation: consumer_confirmation === true,
            preferredClaimLane: requestedClaimLane,
        })
        const linkValidation = await resolveProfileLinkValidation(supabase as any, {
            organizationId: userProfile?.organization_id,
            shopName: userProfile?.shop_name,
            referralPhone: userProfile?.referral_phone,
        })
        const profileCompletion = resolveCollectProfileCompletion({
            name: consumerDisplayName,
            claimLane: laneExperience.claimLane,
            requestedClaimLane,
            organizationId: userProfile?.organization_id,
            organizationTypeCode: orgType,
            shopName: userProfile?.shop_name,
            referralPhone: userProfile?.referral_phone,
            isShopLinkValid: linkValidation.isShopLinkValid,
            isReferenceLinkValid: linkValidation.isReferenceLinkValid,
        })

        const qrShopId = (validation as any).shop_id || null
        const explicitShopId = shop_id || null
        const resolvedScanShopId = explicitShopId || qrShopId
        const resolvedRewardShopId = resolvedScanShopId || (laneExperience.claimLane === 'shop' ? userProfile?.organization_id || null : null)

        // RoadTour does NOT use the product dual-claim lane selection.
        // Users without a shop will be caught by SHOP_REQUIRED / PROFILE_INCOMPLETE gates below.
        // Skip the consumer-choice prompt entirely for RoadTour.

        // Persist consumer confirmation before profile check so it is always saved
        if (laneExperience.claimLane === 'consumer' && consumer_confirmation && userId && !userProfile?.consumer_claim_confirmed_at) {
            const confirmedAt = new Date().toISOString()
            await (supabase as any)
                .from('users')
                .update({ consumer_claim_confirmed_at: confirmedAt, updated_at: confirmedAt })
                .eq('id', userId)
            if (userProfile) {
                userProfile.consumer_claim_confirmed_at = confirmedAt
            }
        }

        if (profileCompletion.shouldBlockCollect) {
            return NextResponse.json(
                {
                    requiresProfileUpdate: true,
                    message: profileCompletion.modalMessage,
                    modalTitle: profileCompletion.modalTitle,
                    modalMessage: profileCompletion.modalMessage,
                    missing: profileCompletion.missingFields,
                    code: 'PROFILE_INCOMPLETE',
                },
                { status: 400 }
            )
        }

        // 2c. Shop context gate — use QR's shop_id when user didn't provide one
        const require_shop_context = (validation as any).require_shop_context
        if (require_shop_context && !resolvedRewardShopId) {
            // Compute real missing-field message based on actual profile state,
            // ignoring consumer lane bypass (which clears profileCompletion.modalMessage)
            const shopMissing = !userProfile?.organization_id
            const shopInvalid = !!userProfile?.organization_id && !linkValidation.isShopLinkValid
            const refMissing = !userProfile?.referral_phone?.trim()
            const refInvalid = !!userProfile?.referral_phone?.trim() && !linkValidation.isReferenceLinkValid
            const shopRequiredMessage = getIncompleteProfileMessage({
                name: consumerDisplayName,
                missingShop: shopMissing,
                missingReference: refMissing,
                invalidShop: shopInvalid,
                invalidReference: refInvalid,
            }) || `Hi ${consumerDisplayName || 'there'}, your **shop** is not valid. Please update your profile before collecting points.`

            return NextResponse.json(
                {
                    requiresProfileUpdate: true,
                    message: shopRequiredMessage,
                    code: 'SHOP_REQUIRED',
                },
                { status: 400 }
            )
        }

        const alreadyClaimed = await hasExistingRoadtourReward({
            supabase,
            campaignId: campaign_id,
            accountManagerUserId: account_manager_user_id,
            scannedByUserId: userId,
            participantPhone: normalizeRoadtourParticipantPhone(userPhone),
            shopId: resolvedRewardShopId,
            duplicateRule: effectiveDuplicateRule,
            roadtourRunId: roadtour_run_id,
        })

        if (alreadyClaimed) {
            const duplicateResponse = getRoadtourDuplicateResponse(effectiveDuplicateRule, roadtourRunName)
            return NextResponse.json(
                {
                    message: duplicateResponse.message,
                    modalTitle: duplicateResponse.title,
                    duplicateScope: duplicateResponse.scope,
                    code: 'DUPLICATE',
                },
                { status: 409 }
            )
        }

        // 2d. Survey gate — if campaign requires survey and none submitted
        if (reward_mode === 'survey_submit' && survey_template_id && !survey_answers) {
            return NextResponse.json(
                { message: 'Please complete the survey to claim your reward.', code: 'SURVEY_REQUIRED' },
                { status: 400 }
            )
        }

        if (reward_mode === 'survey_submit' && !survey_template_id) {
            return NextResponse.json(
                { message: 'This RoadTour campaign is missing a survey template. Please contact the administrator.', code: 'SURVEY_TEMPLATE_MISSING' },
                { status: 500 }
            )
        }

        // 3. Record scan event with geolocation
        console.log('[RT] inserting scan event:', {
            campaign_id,
            qr_code_id,
            account_manager_user_id,
            userId,
            resolvedScanShopId,
            location_status: locationStatus,
            has_coordinates: latitude !== null && longitude !== null,
            geo_label: resolvedGeoLabel,
            location_error: locationError,
        })

        const scanInsertPayload = {
            campaign_id,
            qr_code_id,
            account_manager_user_id,
            scanned_by_user_id: userId || null,
            consumer_phone: normalizeRoadtourParticipantPhone(userPhone) || userPhone || null,
            shop_id: resolvedScanShopId,
            scan_status: 'opened',
            geolocation: normalizedGeolocation || null,
            geo_label: resolvedGeoLabel,
            geo_city: resolvedGeoLocation.geo_city,
            geo_state: resolvedGeoLocation.geo_state,
            geo_country: resolvedGeoLocation.geo_country,
            geo_full_address: resolvedGeoLocation.geo_full_address,
            latitude,
            longitude,
            accuracy_m: accuracyM,
            geo_source: geoSource,
            geo_payload: normalizedGeolocation || null,
            location_status: locationStatus,
            location_error: locationError,
            location_captured_at: locationCapturedAt,
            geo_resolved_at: geoResolvedAt,
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
                latitude: _latitude,
                longitude: _longitude,
                accuracy_m: _accuracyM,
                geo_source: _geoSource,
                geo_payload: _geoPayload,
                location_status: _locationStatus,
                location_error: _locationError,
                location_captured_at: _locationCapturedAt,
                geo_resolved_at: _geoResolvedAt,
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

        const { error: qrUsageError } = await (supabase as any).rpc('record_roadtour_qr_usage', { p_qr_code_id: qr_code_id })
        if (qrUsageError) {
            console.warn('[RT] failed to record QR usage:', qrUsageError.message)
        }

        if (!userId) {
            return NextResponse.json(
                { message: 'Please sign in before claiming this RoadTour reward.', code: 'AUTH_REQUIRED' },
                { status: 401 }
            )
        }

        // 4. If survey mode, save survey response
        let surveyResponseId: string | null = null
        if (reward_mode === 'survey_submit' && survey_template_id && survey_answers) {
            const { data: surveyTemplateFields, error: surveyTemplateFieldsError } = await (supabase as any)
                .from('roadtour_survey_template_fields')
                .select('field_key, field_label, field_type')
                .eq('template_id', survey_template_id)

            if (surveyTemplateFieldsError) {
                return NextResponse.json({ message: 'Failed to load survey template fields.', detail: surveyTemplateFieldsError.message }, { status: 500 })
            }

            const surveyFieldMap = new Map<string, RoadtourSurveyFieldMeta>(
                (surveyTemplateFields || []).map((field: RoadtourSurveyFieldMeta) => [field.field_key, field])
            )

            const pendingSurveyItems = Object.entries(survey_answers)
                .map(([fieldKey, rawValue]) => buildRoadtourSurveyResponseItem({
                    fieldKey,
                    field: surveyFieldMap.get(fieldKey),
                    rawValue,
                }))
                .filter((item): item is RoadtourSurveyResponseItemInsert => Boolean(item))

            if (pendingSurveyItems.length === 0) {
                return NextResponse.json(
                    { message: 'Please complete the survey to claim your reward.', code: 'SURVEY_REQUIRED' },
                    { status: 400 }
                )
            }

            const { data: surveyResp, error: surveyErr } = await (supabase as any)
                .from('roadtour_survey_responses')
                .insert({
                    campaign_id,
                    qr_code_id,
                    account_manager_user_id,
                    scanned_by_user_id: userId,
                    shop_id: resolvedRewardShopId,
                    scan_event_id: scanEvent.id,
                    template_id: survey_template_id,
                    response_status: 'submitted',
                    submitted_at: new Date().toISOString(),
                })
                .select('id')
                .single()

            if (surveyErr) {
                return NextResponse.json({ message: 'Failed to save survey.', detail: surveyErr.message }, { status: 500 })
            }

            surveyResponseId = surveyResp.id

            const items = pendingSurveyItems.map((item) => ({
                response_id: surveyResp.id,
                ...item,
            }))

            if (items.length > 0) {
                const { error: itemsErr } = await (supabase as any).from('roadtour_survey_response_items').insert(items)
                if (itemsErr) {
                    await (supabase as any).from('roadtour_survey_responses').delete().eq('id', surveyResp.id)
                    return NextResponse.json({ message: 'Failed to save survey answers.', detail: itemsErr.message }, { status: 500 })
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
                const duplicateResponse = getRoadtourDuplicateResponse(effectiveDuplicateRule, roadtourRunName)
                await (supabase as any).from('roadtour_scan_events').update({ scan_status: 'duplicate' }).eq('id', scanEvent.id)
                await notifyClaim({
                    scanEventId: scanEvent.id,
                    campaignId: campaign_id,
                    qrCodeId: qr_code_id,
                    accountManagerUserId: account_manager_user_id,
                    notificationType: 'duplicate',
                    campaignName,
                    referenceName,
                    shopName: duplicateShopName || 'Unknown shop',
                    consumerName: consumerDisplayName || 'Unknown consumer',
                    canonicalPath: qrRecord?.canonical_path || null,
                    geoLabel: resolvedGeoLabel,
                    message: duplicateResponse.message,
                })
                return NextResponse.json({
                    message: duplicateResponse.message,
                    modalTitle: duplicateResponse.title,
                    duplicateScope: duplicateResponse.scope,
                    code: 'DUPLICATE',
                }, { status: 409 })
            }
            await notifyClaim({
                scanEventId: scanEvent.id,
                campaignId: campaign_id,
                qrCodeId: qr_code_id,
                accountManagerUserId: account_manager_user_id,
                notificationType: 'failed',
                campaignName,
                referenceName,
                shopName: duplicateShopName || 'Unknown shop',
                consumerName: consumerDisplayName || 'Unknown consumer',
                canonicalPath: qrRecord?.canonical_path || null,
                geoLabel: resolvedGeoLabel,
                message: rewardError.message || 'Reward processing failed.',
            })
            return NextResponse.json(buildRewardErrorPayload(rewardError), { status: 500 })
        }

        // Check if rewardResult indicates duplicate
        if (rewardResult && rewardResult.success === false && rewardResult.error === 'duplicate') {
            const duplicateResponse = getRoadtourDuplicateResponse(effectiveDuplicateRule, roadtourRunName)
            await (supabase as any).from('roadtour_scan_events').update({ scan_status: 'duplicate' }).eq('id', scanEvent.id)
            await notifyClaim({
                scanEventId: scanEvent.id,
                campaignId: campaign_id,
                qrCodeId: qr_code_id,
                accountManagerUserId: account_manager_user_id,
                notificationType: 'duplicate',
                campaignName,
                referenceName,
                shopName: duplicateShopName || 'Unknown shop',
                consumerName: consumerDisplayName || 'Unknown consumer',
                canonicalPath: qrRecord?.canonical_path || null,
                geoLabel: resolvedGeoLabel,
                message: duplicateResponse.message,
            })
            return NextResponse.json({
                message: duplicateResponse.message,
                modalTitle: duplicateResponse.title,
                duplicateScope: duplicateResponse.scope,
                code: 'DUPLICATE',
            }, { status: 409 })
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
            shopName: duplicateShopName || 'Unknown shop',
            consumerName: consumerDisplayName || 'Unknown consumer',
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
