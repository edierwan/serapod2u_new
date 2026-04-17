import {
    INVALID_REFERENCE_WARNING_MESSAGE,
    INVALID_SHOP_WARNING_MESSAGE,
} from '@/lib/engagement/profile-link-validation'

export interface IncompleteProfileMessageInput {
    name?: string | null
    missingShop: boolean
    missingReference: boolean
    invalidShop?: boolean
    invalidReference?: boolean
}

export interface CollectProfileCompletionInput {
    name?: string | null
    claimLane?: 'shop' | 'consumer' | null
    requestedClaimLane?: 'shop' | null
    organizationId?: string | null
    organizationTypeCode?: string | null
    shopName?: string | null
    referralPhone?: string | null
    isShopLinkValid?: boolean | null
    isReferenceLinkValid?: boolean | null
}

export interface CollectProfileCompletionResult {
    shouldBlockCollect: boolean
    modalTitle: string
    modalMessage: string
    missingShop: boolean
    missingReference: boolean
    invalidShop: boolean
    invalidReference: boolean
    missingFields: string[]
}

function hasValue(value?: string | null): boolean {
    return Boolean(value?.trim())
}

export function hasValidLinkedShop(input: Pick<CollectProfileCompletionInput, 'organizationId' | 'organizationTypeCode'>): boolean {
    if (typeof (input as any).isShopLinkValid === 'boolean') {
        return (input as any).isShopLinkValid
    }

    if (!hasValue(input.organizationId)) {
        return false
    }

    const orgTypeCode = input.organizationTypeCode?.trim().toUpperCase()
    return !orgTypeCode || orgTypeCode === 'SHOP'
}

export function hasValidReferenceLink(input: Pick<CollectProfileCompletionInput, 'referralPhone'>): boolean {
    if (typeof (input as any).isReferenceLinkValid === 'boolean') {
        return (input as any).isReferenceLinkValid
    }

    return hasValue(input.referralPhone)
}

function hasShopProfileValue(input: Pick<CollectProfileCompletionInput, 'organizationId' | 'shopName'>): boolean {
    return hasValue(input.organizationId) || hasValue(input.shopName)
}

export function getIncompleteProfileMessage(input: IncompleteProfileMessageInput): string {
    const resolvedName = input.name?.trim() || 'there'

    if (input.invalidShop && input.invalidReference) {
        return `Hi ${resolvedName}, your shop and reference are not valid. Please update your profile before collecting points.`
    }

    if (input.invalidShop) {
        return INVALID_SHOP_WARNING_MESSAGE
    }

    if (input.invalidReference) {
        return INVALID_REFERENCE_WARNING_MESSAGE
    }

    if (input.missingShop && input.missingReference) {
        return `Hi ${resolvedName}, it looks like your shop and reference are not updated yet. Please update your profile before collecting points.`
    }

    if (input.missingShop) {
        return `Hi ${resolvedName}, it looks like your shop is not updated yet. Please update your profile before collecting points.`
    }

    if (input.missingReference) {
        return `Hi ${resolvedName}, it looks like your reference is not updated yet. Please update your profile before collecting points.`
    }

    return ''
}

export function resolveCollectProfileCompletion(input: CollectProfileCompletionInput): CollectProfileCompletionResult {
    const requiresShopProfile = input.claimLane === 'shop' || input.requestedClaimLane === 'shop'
    const hasShopValue = hasShopProfileValue(input)
    const hasReferenceValue = hasValue(input.referralPhone)
    const validShopLink = hasValidLinkedShop(input)
    const validReferenceLink = hasValidReferenceLink(input)

    const missingShop = requiresShopProfile && !hasShopValue
    const invalidShop = requiresShopProfile && hasValue(input.organizationId) && !validShopLink
    const missingReference = requiresShopProfile && !hasReferenceValue
    const invalidReference = requiresShopProfile && hasReferenceValue && !validReferenceLink
    const shouldBlockCollect = missingShop || missingReference || invalidShop || invalidReference
    const missingFields: string[] = []

    if (missingShop || invalidShop) {
        missingFields.push('Shop')
    }

    if (missingReference || invalidReference) {
        missingFields.push('Reference')
    }

    return {
        shouldBlockCollect,
        modalTitle: 'Complete Your Profile',
        modalMessage: shouldBlockCollect
            ? getIncompleteProfileMessage({
                name: input.name,
                missingShop,
                missingReference,
                invalidShop,
                invalidReference,
            })
            : '',
        missingShop,
        missingReference,
        invalidShop,
        invalidReference,
        missingFields,
    }
}
