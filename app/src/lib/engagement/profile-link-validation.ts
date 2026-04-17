import { normalizePhoneE164, samePhone } from '@/utils/phone'

export const INVALID_REFERENCE_WARNING_MESSAGE = 'This reference is not valid, please do update the reference before you can claim.'
export const INVALID_SHOP_WARNING_MESSAGE = 'This shop is not valid, please do update the shop before you can claim.'

export interface ProfileLinkValidationInput {
    organizationId?: string | null
    shopName?: string | null
    referralPhone?: string | null
    referenceUserId?: string | null
}

export interface ProfileLinkValidationResult {
    hasShopValue: boolean
    isShopLinkValid: boolean
    invalidShop: boolean
    organizationTypeCode: string | null
    organizationName: string | null
    hasReferenceValue: boolean
    isReferenceLinkValid: boolean
    invalidReference: boolean
    referenceUserId: string | null
    referenceDisplayName: string | null
}

function hasValue(value?: string | null): boolean {
    return Boolean(value?.trim())
}

function buildPhoneCandidates(phone?: string | null): string[] {
    const raw = phone?.trim() || ''
    if (!raw) return []

    const normalized = normalizePhoneE164(raw)
    const withoutPlus = normalized.replace(/^\+/, '')
    const local = withoutPlus.startsWith('60') ? `0${withoutPlus.slice(2)}` : withoutPlus

    return Array.from(new Set([raw, normalized, withoutPlus, local].filter(Boolean)))
}

export async function resolveProfileLinkValidation(
    supabaseAdmin: any,
    input: ProfileLinkValidationInput,
): Promise<ProfileLinkValidationResult> {
    const hasShopValue = hasValue(input.shopName) || hasValue(input.organizationId)
    const hasReferenceValue = hasValue(input.referralPhone) || hasValue(input.referenceUserId)

    let organizationTypeCode: string | null = null
    let organizationName: string | null = null
    let isShopLinkValid = false

    if (hasValue(input.organizationId)) {
        const { data: organization } = await supabaseAdmin
            .from('organizations')
            .select('id, org_type_code, org_name, is_active')
            .eq('id', input.organizationId)
            .maybeSingle()

        organizationTypeCode = organization?.org_type_code || null
        organizationName = organization?.org_name || null
        isShopLinkValid = Boolean(organization?.is_active && organization?.org_type_code === 'SHOP')
    }

    let referenceUserId: string | null = null
    let referenceDisplayName: string | null = null
    let isReferenceLinkValid = false

    if (hasValue(input.referenceUserId)) {
        const { data: referenceUser } = await supabaseAdmin
            .from('users')
            .select('id, phone, full_name, call_name, can_be_reference, is_active')
            .eq('id', input.referenceUserId)
            .maybeSingle()

        if (referenceUser) {
            referenceUserId = referenceUser.id || null
            referenceDisplayName = referenceUser.call_name?.trim()
                || referenceUser.full_name?.trim()
                || null
            isReferenceLinkValid = Boolean(referenceUser.can_be_reference && referenceUser.is_active)
        }
    }

    if (!referenceUserId && hasValue(input.referralPhone)) {
        const phoneCandidates = buildPhoneCandidates(input.referralPhone)

        if (phoneCandidates.length > 0) {
            const { data: candidateUsers } = await supabaseAdmin
                .from('users')
                .select('id, phone, full_name, call_name, can_be_reference, is_active')
                .in('phone', phoneCandidates)

            const matchingUsers = (candidateUsers || []).filter((candidate: any) =>
                samePhone(candidate.phone, input.referralPhone)
            )

            const matchedUser = matchingUsers.find((candidate: any) => candidate.can_be_reference && candidate.is_active)
                || matchingUsers.find((candidate: any) => candidate.is_active)
                || matchingUsers[0]

            if (matchedUser) {
                referenceUserId = matchedUser.id || null
                referenceDisplayName = matchedUser.call_name?.trim()
                    || matchedUser.full_name?.trim()
                    || null
                isReferenceLinkValid = Boolean(matchedUser.can_be_reference && matchedUser.is_active)
            }
        }
    }

    return {
        hasShopValue,
        isShopLinkValid,
        invalidShop: hasValue(input.organizationId) && !isShopLinkValid,
        organizationTypeCode,
        organizationName,
        hasReferenceValue,
        isReferenceLinkValid,
        invalidReference: hasReferenceValue && !isReferenceLinkValid,
        referenceUserId,
        referenceDisplayName,
    }
}