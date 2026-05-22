export const INVALID_SIGNUP_REFERENCE_SELECTION_MESSAGE = 'Please select a valid reference from the list.'
export const INVALID_SIGNUP_SHOP_SELECTION_MESSAGE = 'Please select a valid shop from the list.'

interface RegistrationLinkSelectionInput {
  referenceValue?: string | null
  referenceUserId?: string | null
  shopValue?: string | null
  shopOrganizationId?: string | null
}

export function validateRegistrationLinkSelections(input: RegistrationLinkSelectionInput) {
  const referenceValue = input.referenceValue?.trim() || ''
  const shopValue = input.shopValue?.trim() || ''
  const referenceUserId = input.referenceUserId?.trim() || ''
  const shopOrganizationId = input.shopOrganizationId?.trim() || ''

  const referenceError = referenceValue && referenceUserId
    ? null
    : INVALID_SIGNUP_REFERENCE_SELECTION_MESSAGE
  const shopError = shopValue && shopOrganizationId
    ? null
    : INVALID_SIGNUP_SHOP_SELECTION_MESSAGE

  return {
    referenceError,
    shopError,
    isValid: !referenceError && !shopError,
  }
}