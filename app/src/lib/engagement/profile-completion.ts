export interface IncompleteProfileMessageInput {
  name?: string | null
  missingShop: boolean
  missingReference: boolean
}

export interface CollectProfileCompletionInput {
  name?: string | null
  claimLane?: 'shop' | 'consumer' | null
  requestedClaimLane?: 'shop' | null
  organizationId?: string | null
  organizationTypeCode?: string | null
  referralPhone?: string | null
}

export interface CollectProfileCompletionResult {
  shouldBlockCollect: boolean
  modalTitle: string
  modalMessage: string
  missingShop: boolean
  missingReference: boolean
  missingFields: string[]
}

function hasValue(value?: string | null): boolean {
  return Boolean(value?.trim())
}

export function hasValidLinkedShop(input: Pick<CollectProfileCompletionInput, 'organizationId' | 'organizationTypeCode'>): boolean {
  if (!hasValue(input.organizationId)) {
    return false
  }

  const orgTypeCode = input.organizationTypeCode?.trim().toUpperCase()
  return !orgTypeCode || orgTypeCode === 'SHOP'
}

export function hasValidReferenceLink(input: Pick<CollectProfileCompletionInput, 'referralPhone'>): boolean {
  return hasValue(input.referralPhone)
}

export function getIncompleteProfileMessage(input: IncompleteProfileMessageInput): string {
  const resolvedName = input.name?.trim() || 'there'

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
  const missingShop = requiresShopProfile && !hasValidLinkedShop(input)
  const missingReference = requiresShopProfile && !hasValidReferenceLink(input)
  const shouldBlockCollect = missingShop || missingReference
  const missingFields: string[] = []

  if (missingShop) {
    missingFields.push('Shop')
  }

  if (missingReference) {
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
        })
      : '',
    missingShop,
    missingReference,
    missingFields,
  }
}
