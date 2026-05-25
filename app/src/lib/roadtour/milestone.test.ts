import { describe, expect, it } from 'vitest'

import {
    buildMilestoneClaimResponse,
    getConsumerCollectScanId,
    getPrimaryRoadtourProgressMission,
    normalizeCreateMissionResult,
    normalizeProgressResult,
    normalizeRoadtourMilestoneMission,
} from './milestone'

const missionPayload = {
    mission_id: 'mission-1',
    reward_status: 'pending',
    campaign_reward_points: 80,
    required_product_qr_scans: 3,
    current_valid_product_scan_count: 1,
    remaining_product_qr_scans: 2,
    period_start: '2026-05-24T00:00:00+08:00',
    period_end: '2026-06-24T00:00:00+08:00',
    completed_at: null,
    awarded_at: null,
    message: 'You will be entitled to 80 points after scanning 3 product QR codes.',
}

describe('RoadTour milestone normalization', () => {
    it('normalizes a valid mission payload', () => {
        expect(normalizeRoadtourMilestoneMission(missionPayload)).toEqual(missionPayload)
    })

    it('rejects malformed mission payloads', () => {
        expect(normalizeRoadtourMilestoneMission({ ...missionPayload, reward_status: 'unknown' })).toBeNull()
        expect(normalizeRoadtourMilestoneMission({ ...missionPayload, required_product_qr_scans: '3' })).toBeNull()
    })

    it('builds a milestone claim response without newly awarded RoadTour QR points', () => {
        const mission = normalizeRoadtourMilestoneMission(missionPayload)
        expect(mission).not.toBeNull()

        const response = buildMilestoneClaimResponse(mission!)
        expect(response.points_awarded).toBe(0)
        expect(response.roadtour_reward_deferred).toBe(true)
        expect(response.milestone_progress).toEqual({ current: 1, required: 3, remaining: 2 })

        const awardedMission = normalizeRoadtourMilestoneMission({
            ...missionPayload,
            reward_status: 'awarded',
            current_valid_product_scan_count: 3,
            remaining_product_qr_scans: 0,
            completed_at: '2026-05-25T00:00:00+08:00',
            awarded_at: '2026-05-25T00:00:00+08:00',
            message: 'Milestone completed. 80 points awarded.',
        })
        expect(awardedMission).not.toBeNull()

        const awardedResponse = buildMilestoneClaimResponse(awardedMission!)
        expect(awardedResponse.points_awarded).toBe(0)
        expect(awardedResponse.roadtour_reward_deferred).toBe(true)
        expect(awardedResponse.milestone_progress).toEqual({ current: 3, required: 3, remaining: 0 })
    })

    it('filters invalid missions from product QR progress responses', () => {
        const result = normalizeProgressResult({
            success: true,
            milestone_evaluated: true,
            milestone_awarded: false,
            duplicate_product_qr: true,
            reason: 'duplicate_product_qr',
            missions: [missionPayload, { ...missionPayload, mission_id: null }],
        })

        expect(result.success).toBe(true)
        expect(result.duplicate_product_qr).toBe(true)
        expect(result.missions).toHaveLength(1)
        expect(result.missions[0]?.mission_id).toBe('mission-1')
        expect(getPrimaryRoadtourProgressMission(result)?.mission_id).toBe('mission-1')
    })

    it('prefers the awarded mission when multiple RoadTour missions are returned', () => {
        const result = normalizeProgressResult({
            success: true,
            milestone_evaluated: true,
            milestone_awarded: true,
            duplicate_product_qr: false,
            reason: null,
            missions: [
                missionPayload,
                {
                    ...missionPayload,
                    mission_id: 'mission-2',
                    reward_status: 'awarded',
                    current_valid_product_scan_count: 3,
                    remaining_product_qr_scans: 0,
                    completed_at: '2026-05-25T00:00:00+08:00',
                    awarded_at: '2026-05-25T00:00:00+08:00',
                    message: 'Milestone completed. 80 points awarded.',
                },
            ],
        })

        expect(getPrimaryRoadtourProgressMission(result)?.mission_id).toBe('mission-2')
    })

    it('guards invalid RPC responses and extracts collect scan ids', () => {
        expect(normalizeCreateMissionResult(null)).toMatchObject({
            success: false,
            code: 'INVALID_MILESTONE_RESPONSE',
        })
        expect(getConsumerCollectScanId({ scan_id: 'scan-1' })).toBe('scan-1')
        expect(getConsumerCollectScanId({ scan_id: 123 })).toBeNull()
    })
})