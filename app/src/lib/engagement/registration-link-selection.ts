export const SIGNUP_REFERENCE_REQUIRED_MESSAGE = 'Reference is required.'
export const INVALID_SIGNUP_REFERENCE_SELECTION_MESSAGE = 'Please select a valid reference from the list.'
export const SIGNUP_SHOP_REQUIRED_MESSAGE = 'Shop name is required.'
export const INVALID_SIGNUP_SHOP_SELECTION_MESSAGE = 'Please select a valid shop from the list.'
export const SIGNUP_PASSWORD_REQUIRED_MESSAGE = 'Password is required.'
export const SIGNUP_PASSWORD_MIN_LENGTH_MESSAGE = 'Password must be at least 6 characters.'
export const SIGNUP_CONFIRM_PASSWORD_REQUIRED_MESSAGE = 'Confirm password is required.'
export const SIGNUP_PASSWORDS_DO_NOT_MATCH_MESSAGE = 'Passwords do not match'
export const SIGNUP_PASSWORDS_MATCH_MESSAGE = 'Passwords match'

interface RegistrationLinkSelectionInput {
  referenceValue?: string | null
  referenceUserId?: string | null
  shopValue?: string | null
  shopOrganizationId?: string | null
}

export function getRegistrationReferenceSelectionError(
  referenceValue?: string | null,
  referenceUserId?: string | null,
) {
  const normalizedReferenceValue = referenceValue?.trim() || ''
  const normalizedReferenceUserId = referenceUserId?.trim() || ''

  if (!normalizedReferenceValue) return SIGNUP_REFERENCE_REQUIRED_MESSAGE
  if (!normalizedReferenceUserId) return INVALID_SIGNUP_REFERENCE_SELECTION_MESSAGE

  return null
}

export function getRegistrationShopSelectionError(
  shopValue?: string | null,
  shopOrganizationId?: string | null,
) {
  const normalizedShopValue = shopValue?.trim() || ''
  const normalizedShopOrganizationId = shopOrganizationId?.trim() || ''

  if (!normalizedShopValue) return SIGNUP_SHOP_REQUIRED_MESSAGE
  if (!normalizedShopOrganizationId) return INVALID_SIGNUP_SHOP_SELECTION_MESSAGE

  return null
}

export function validateRegistrationPasswordFields(
  password?: string | null,
  confirmPassword?: string | null,
) {
  const normalizedPassword = password || ''
  const normalizedConfirmPassword = confirmPassword || ''

  const passwordError = !normalizedPassword
    ? SIGNUP_PASSWORD_REQUIRED_MESSAGE
    : normalizedPassword.length < 6
      ? SIGNUP_PASSWORD_MIN_LENGTH_MESSAGE
      : null

  const confirmPasswordError = !normalizedConfirmPassword
    ? SIGNUP_CONFIRM_PASSWORD_REQUIRED_MESSAGE
    : normalizedPassword !== normalizedConfirmPassword
      ? SIGNUP_PASSWORDS_DO_NOT_MATCH_MESSAGE
      : null

  const confirmPasswordSuccess = !passwordError && !confirmPasswordError && normalizedConfirmPassword
    ? SIGNUP_PASSWORDS_MATCH_MESSAGE
    : null

  return {
    passwordError,
    confirmPasswordError,
    confirmPasswordSuccess,
    isValid: !passwordError && !confirmPasswordError,
  }
}

export function validateRegistrationLinkSelections(input: RegistrationLinkSelectionInput) {
  const referenceError = getRegistrationReferenceSelectionError(
    input.referenceValue,
    input.referenceUserId,
  )
  const shopError = getRegistrationShopSelectionError(
    input.shopValue,
    input.shopOrganizationId,
  )

  return {
    referenceError,
    shopError,
    isValid: !referenceError && !shopError,
  }
}