import { describe, expect, it } from 'vitest'

import {
    DUPLICATE_POLICY_LABEL,
    getRoadtourDuplicateResponse,
    isSameRoadtourParticipantPhone,
    normalizeRoadtourParticipantPhone,
} from './duplicate-protection'

describe('roadtour duplicate protection', () => {
    it('normalizes participant phone formats consistently', () => {
        expect(normalizeRoadtourParticipantPhone('+60145600453')).toBe('+60145600453')
        expect(normalizeRoadtourParticipantPhone('0145600453')).toBe('+60145600453')
        expect(normalizeRoadtourParticipantPhone('60 14-560 0453')).toBe('+60145600453')
        expect(isSameRoadtourParticipantPhone('+60145600453', '0145600453')).toBe(true)
        expect(isSameRoadtourParticipantPhone('0145600453', '01126854733')).toBe(false)
    })

    it('labels participant-level event protection accurately', () => {
        expect(DUPLICATE_POLICY_LABEL.one_participant_once_per_event).toBe('One participant once per event')
    })

    it('returns participant-level duplicate copy', () => {
        expect(getRoadtourDuplicateResponse('one_participant_once_per_event')).toEqual({
            title: 'Already Claimed',
            message: 'This account or phone number has already claimed this RoadTour reward.',
            scope: 'participant',
        })
    })

    it('returns shop-level duplicate copy for shop-scoped event protection', () => {
        expect(getRoadtourDuplicateResponse('per_run', 'RoadTour 2026')).toEqual({
            title: 'Shop Limit Reached',
            message: 'This shop has already reached the claim limit for this RoadTour event (RoadTour 2026).',
            scope: 'shop_event',
        })
    })
})