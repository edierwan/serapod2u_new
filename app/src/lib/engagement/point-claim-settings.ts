import { hasValidLinkedShop, hasValidReferenceLink } from '@/lib/engagement/profile-completion'

export type PointClaimMode = 'single_shop' | 'dual'
export type PointClaimLane = 'shop' | 'consumer'

export interface PointClaimSettings {
    claimMode: PointClaimMode
    shopPointsPerScan: number
    consumerPointsPerScan: number
    pointValueRM: number
}

interface ShopLinkProfile {
    organization_id?: string | null
    organizationTypeCode?: string | null
    shop_name?: string | null
    referral_phone?: string | null
}

interface ConsumerClaimConfirmationInput extends ShopLinkProfile {
    claimLane: PointClaimLane
    consumerClaimConfirmedAt?: string | null
}

interface ClaimLaneExperienceInput extends ShopLinkProfile {
    claimMode: PointClaimMode
    consumerClaimConfirmedAt?: string | null
    consumerConfirmation?: boolean
    preferredClaimLane?: 'shop' | null
}

export interface ClaimLaneExperienceResult {
    claimLane: PointClaimLane
    hasLinkedShopProfile: boolean
    consumerPathAvailable: boolean
    shouldPromptConsumerChoice: boolean
    shouldRequireShopProfile: boolean
}

function toPositiveNumber(value: unknown, fallback: number) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function toNonNegativeNumber(value: unknown, fallback: number) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export function normalizePointClaimSettings(rawSettings: any, fallbackShopPoints: number): PointClaimSettings {
    const safeShopPoints = toPositiveNumber(fallbackShopPoints, 100)
    const claimMode: PointClaimMode = rawSettings?.point_claim_mode === 'dual' ? 'dual' : 'single_shop'
    const pointValueRM = toNonNegativeNumber(rawSettings?.point_value_rm, 0)
    const consumerDefault = rawSettings?.consumer_points_per_scan === undefined
        ? safeShopPoints
        : rawSettings?.consumer_points_per_scan

    return {
        claimMode,
        shopPointsPerScan: safeShopPoints,
        consumerPointsPerScan: toNonNegativeNumber(consumerDefault, safeShopPoints),
        pointValueRM,
    }
}

export function resolvePointClaimLane(orgTypeCode?: string | null): PointClaimLane {
    return orgTypeCode === 'SHOP' ? 'shop' : 'consumer'
}

export function hasLinkedShopProfile(profile: ShopLinkProfile): boolean {
    return hasValidLinkedShop({
        organizationId: profile.organization_id,
        organizationTypeCode: profile.organizationTypeCode,
    }) && hasValidReferenceLink({
        referralPhone: profile.referral_phone,
    })
}

export function requiresConsumerClaimConfirmation(input: ConsumerClaimConfirmationInput): boolean {
    return input.claimLane === 'consumer'
        && !input.consumerClaimConfirmedAt
        && !hasLinkedShopProfile(input)
}

export function resolveClaimLaneExperience(input: ClaimLaneExperienceInput): ClaimLaneExperienceResult {
    const linkedShopProfile = hasLinkedShopProfile(input)
    const organizationClaimLane = resolvePointClaimLane(input.organizationTypeCode)
    const canUseShopLane = organizationClaimLane === 'shop' || linkedShopProfile

    if (input.claimMode !== 'dual') {
        return {
            claimLane: 'shop',
            hasLinkedShopProfile: linkedShopProfile,
            consumerPathAvailable: false,
            shouldPromptConsumerChoice: false,
            shouldRequireShopProfile: !canUseShopLane,
        }
    }

    if (canUseShopLane) {
        return {
            claimLane: 'shop',
            hasLinkedShopProfile: linkedShopProfile,
            consumerPathAvailable: true,
            shouldPromptConsumerChoice: false,
            shouldRequireShopProfile: false,
        }
    }

    if (input.preferredClaimLane === 'shop') {
        return {
            claimLane: 'shop',
            hasLinkedShopProfile: linkedShopProfile,
            consumerPathAvailable: true,
            shouldPromptConsumerChoice: false,
            shouldRequireShopProfile: true,
        }
    }

    if (input.consumerConfirmation || input.consumerClaimConfirmedAt) {
        return {
            claimLane: 'consumer',
            hasLinkedShopProfile: linkedShopProfile,
            consumerPathAvailable: true,
            shouldPromptConsumerChoice: false,
            shouldRequireShopProfile: false,
        }
    }

    return {
        claimLane: 'consumer',
        hasLinkedShopProfile: linkedShopProfile,
        consumerPathAvailable: true,
        shouldPromptConsumerChoice: true,
        shouldRequireShopProfile: false,
    }
}

export function resolveRemainingClaimLane(claimMode: PointClaimMode, claimLane: PointClaimLane): PointClaimLane | null {
    if (claimMode !== 'dual') {
        return null
    }

    return claimLane === 'shop' ? 'consumer' : 'shop'
}
