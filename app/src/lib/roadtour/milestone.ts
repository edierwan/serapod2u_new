import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'

export type RoadtourPointReleaseRule = 'immediate_after_roadtour_claim' | 'product_qr_scan_target_once'
export type RoadtourProductQrCountingPeriod = 'rolling_1_month' | 'rolling_2_months' | 'open_period'
export type RoadtourMissionStatus = 'pending' | 'completed' | 'awarded' | 'expired' | 'cancelled'

export interface RoadtourMilestoneMission {
    mission_id: string
    reward_status: RoadtourMissionStatus
    campaign_reward_points: number
    required_product_qr_scans: number
    current_valid_product_scan_count: number
    remaining_product_qr_scans: number
    period_start: string
    period_end: string
    completed_at: string | null
    awarded_at: string | null
    message: string
}

export interface RoadtourCreateMissionResult {
    success: boolean
    roadtour_reward_deferred: boolean
    code: string | null
    message: string | null
    mission: RoadtourMilestoneMission | null
}

export interface RoadtourProductQrProgressResult {
    success: boolean
    milestone_evaluated: boolean
    milestone_awarded: boolean
    duplicate_product_qr: boolean
    reason: string | null
    missions: RoadtourMilestoneMission[]
}

type RoadtourSupabaseClient = SupabaseClient<Database>
type RoadtourMissionRow = Database['public']['Tables']['roadtour_participant_missions']['Row']

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
    return typeof value === 'string' ? value : null
}

function numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null
}

function missionStatusValue(value: unknown): RoadtourMissionStatus | null {
    if (
        value === 'pending' ||
        value === 'completed' ||
        value === 'awarded' ||
        value === 'expired' ||
        value === 'cancelled'
    ) {
        return value
    }

    return null
}

export function normalizeRoadtourMilestoneMission(value: unknown): RoadtourMilestoneMission | null {
    if (!isRecord(value)) return null

    const missionId = stringValue(value.mission_id)
    const rewardStatus = missionStatusValue(value.reward_status)
    const campaignRewardPoints = numberValue(value.campaign_reward_points)
    const requiredProductQrScans = numberValue(value.required_product_qr_scans)
    const currentValidProductScanCount = numberValue(value.current_valid_product_scan_count)
    const remainingProductQrScans = numberValue(value.remaining_product_qr_scans)
    const periodStart = stringValue(value.period_start)
    const periodEnd = stringValue(value.period_end)
    const message = stringValue(value.message)

    if (
        !missionId ||
        !rewardStatus ||
        campaignRewardPoints === null ||
        requiredProductQrScans === null ||
        currentValidProductScanCount === null ||
        remainingProductQrScans === null ||
        !periodStart ||
        !periodEnd ||
        !message
    ) {
        return null
    }

    return {
        mission_id: missionId,
        reward_status: rewardStatus,
        campaign_reward_points: campaignRewardPoints,
        required_product_qr_scans: requiredProductQrScans,
        current_valid_product_scan_count: currentValidProductScanCount,
        remaining_product_qr_scans: remainingProductQrScans,
        period_start: periodStart,
        period_end: periodEnd,
        completed_at: stringValue(value.completed_at),
        awarded_at: stringValue(value.awarded_at),
        message,
    }
}

export function missionRowToMilestoneMission(row: RoadtourMissionRow): RoadtourMilestoneMission | null {
    const remainingProductQrScans = Math.max(row.required_product_qr_scans_snapshot - row.current_valid_product_scan_count, 0)
    const message = row.reward_status === 'awarded'
        ? `Milestone completed. ${row.campaign_reward_points_snapshot} points awarded.`
        : row.reward_status === 'expired'
            ? 'This RoadTour reward period has ended.'
            : `You will be entitled to ${row.campaign_reward_points_snapshot} points after scanning ${row.required_product_qr_scans_snapshot} product QR codes.`

    return normalizeRoadtourMilestoneMission({
        mission_id: row.id,
        reward_status: row.reward_status,
        campaign_reward_points: row.campaign_reward_points_snapshot,
        required_product_qr_scans: row.required_product_qr_scans_snapshot,
        current_valid_product_scan_count: row.current_valid_product_scan_count,
        remaining_product_qr_scans: remainingProductQrScans,
        period_start: row.period_start,
        period_end: row.effective_period_end,
        completed_at: row.completed_at,
        awarded_at: row.awarded_at,
        message,
    })
}

export function buildMilestoneClaimResponse(mission: RoadtourMilestoneMission) {
    return {
        message: mission.message,
        points_awarded: 0,
        roadtour_reward_deferred: true,
        roadtour_milestone: mission,
        milestone_progress: {
            current: mission.current_valid_product_scan_count,
            required: mission.required_product_qr_scans,
            remaining: mission.remaining_product_qr_scans,
        },
    }
}

export function normalizeCreateMissionResult(value: Json | null): RoadtourCreateMissionResult {
    if (!isRecord(value)) {
        return {
            success: false,
            roadtour_reward_deferred: false,
            code: 'INVALID_MILESTONE_RESPONSE',
            message: 'RoadTour milestone response was not valid.',
            mission: null,
        }
    }

    return {
        success: booleanValue(value.success) ?? false,
        roadtour_reward_deferred: booleanValue(value.roadtour_reward_deferred) ?? false,
        code: stringValue(value.code),
        message: stringValue(value.message),
        mission: normalizeRoadtourMilestoneMission(value.mission),
    }
}

export function normalizeProgressResult(value: Json | null): RoadtourProductQrProgressResult {
    if (!isRecord(value)) {
        return {
            success: false,
            milestone_evaluated: false,
            milestone_awarded: false,
            duplicate_product_qr: false,
            reason: 'invalid_milestone_response',
            missions: [],
        }
    }

    const missionsValue = Array.isArray(value.missions) ? value.missions : []
    const missions = missionsValue
        .map((mission) => normalizeRoadtourMilestoneMission(mission))
        .filter((mission): mission is RoadtourMilestoneMission => mission !== null)

    return {
        success: booleanValue(value.success) ?? false,
        milestone_evaluated: booleanValue(value.milestone_evaluated) ?? false,
        milestone_awarded: booleanValue(value.milestone_awarded) ?? false,
        duplicate_product_qr: booleanValue(value.duplicate_product_qr) ?? false,
        reason: stringValue(value.reason),
        missions,
    }
}

export function getConsumerCollectScanId(value: Json | null): string | null {
    if (!isRecord(value)) return null
    return stringValue(value.scan_id)
}

export async function createRoadtourParticipantMission(
    supabase: RoadtourSupabaseClient,
    params: {
        roadtourEventId: string
        roadtourCampaignId: string
        participantUserId: string
        participantPhone: string
        enrollmentScanEventId: string
        shopId: string | null
        createdBy: string | null
    },
): Promise<RoadtourCreateMissionResult> {
    const { data, error } = await supabase.rpc('roadtour_create_participant_mission', {
        p_roadtour_event_id: params.roadtourEventId,
        p_roadtour_campaign_id: params.roadtourCampaignId,
        p_participant_user_id: params.participantUserId,
        p_participant_phone: params.participantPhone,
        p_enrollment_scan_event_id: params.enrollmentScanEventId,
        p_shop_id: params.shopId ?? undefined,
        p_created_by: params.createdBy ?? undefined,
    })

    if (error) throw error
    return normalizeCreateMissionResult(data)
}

export async function recordRoadtourProductQrMilestoneProgress(
    supabase: RoadtourSupabaseClient,
    productScanEventId: string,
): Promise<RoadtourProductQrProgressResult> {
    const { data, error } = await supabase.rpc('roadtour_record_product_qr_milestone_progress', {
        p_product_scan_event_id: productScanEventId,
    })

    if (error) throw error
    return normalizeProgressResult(data)
}
