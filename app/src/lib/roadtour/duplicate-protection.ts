import { normalizePhoneE164 } from '@/utils/phone'

export type RoadtourDuplicatePolicy =
    | 'one_participant_once_per_event'
    | 'one_participant_once_per_campaign'
    | 'per_run'
    | 'per_campaign'
    | 'per_day'
    | 'none'

export const DUPLICATE_POLICY_LABEL: Record<RoadtourDuplicatePolicy, string> = {
    one_participant_once_per_event: 'One participant once per event',
    one_participant_once_per_campaign: 'One participant once per campaign',
    per_run: 'One shop once per event',
    per_campaign: 'One shop once per campaign',
    per_day: 'One shop once per day',
    none: 'No duplicate restriction',
}

export const DUPLICATE_POLICY_OPTIONS: Array<{
    value: RoadtourDuplicatePolicy
    label: string
    description: string
    recommended?: boolean
}> = [
    {
        value: 'one_participant_once_per_event',
        label: 'One participant once per event',
        description: 'Recommended for staff rewards. Different workers from the same shop can each claim once per RoadTour Event.',
        recommended: true,
    },
    {
        value: 'one_participant_once_per_campaign',
        label: 'One participant once per campaign',
        description: 'Same user or phone can claim once per campaign. Different workers from the same shop can claim independently.',
    },
    {
        value: 'per_run',
        label: 'One shop once per event',
        description: 'Use only when the reward is intended once per shop across the whole RoadTour Event.',
    },
    {
        value: 'per_campaign',
        label: 'One shop once per campaign',
        description: 'Same shop can be rewarded by different campaigns in the same event.',
    },
    {
        value: 'per_day',
        label: 'One shop once per day',
        description: 'Each shop can be rewarded once per calendar day within the event.',
    },
    {
        value: 'none',
        label: 'No duplicate restriction',
        description: 'No automatic block. Use only for special diagnostic runs.',
    },
]

export function normalizeRoadtourParticipantPhone(phone?: string | null) {
    const normalized = normalizePhoneE164(String(phone || '').trim())
    return normalized || null
}

export function isSameRoadtourParticipantPhone(left?: string | null, right?: string | null) {
    const normalizedLeft = normalizeRoadtourParticipantPhone(left)
    const normalizedRight = normalizeRoadtourParticipantPhone(right)
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

export function getRoadtourDuplicateResponse(
    duplicatePolicy?: string | null,
    roadtourRunName?: string | null,
) {
    const eventLabel = roadtourRunName ? ` (${roadtourRunName})` : ''

    if (duplicatePolicy === 'per_run') {
        return {
            title: 'Shop Limit Reached',
            message: `This shop has already reached the claim limit for this RoadTour event${eventLabel}.`,
            scope: 'shop_event' as const,
        }
    }

    if (duplicatePolicy === 'per_campaign') {
        return {
            title: 'Shop Limit Reached',
            message: 'This shop has already reached the claim limit for this RoadTour campaign.',
            scope: 'shop_campaign' as const,
        }
    }

    if (duplicatePolicy === 'per_day') {
        return {
            title: 'Shop Limit Reached',
            message: 'This shop has already reached the daily claim limit for this RoadTour event.',
            scope: 'shop_day' as const,
        }
    }

    return {
        title: 'Already Claimed',
        message: 'This account or phone number has already claimed this RoadTour reward.',
        scope: 'participant' as const,
    }
}