import { sanitizeShopRequestForm, type ShopRequestFormInput } from '@/lib/shop-requests/core'

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
  pendingShopRequest?: ShopRequestFormInput | null
}

export interface RegistrationPendingShopRequest extends ShopRequestFormInput {}

function normalizeLabel(value?: string | null) {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function sanitizeRegistrationPendingShopRequest(
  pendingShopRequest?: RegistrationPendingShopRequest | null,
) {
  if (!pendingShopRequest) return null

  const form = sanitizeShopRequestForm(pendingShopRequest)
  return form.shopName ? form : null
}

export function getRegistrationPendingShopDisplayName(
  pendingShopRequest?: RegistrationPendingShopRequest | null,
) {
  const form = sanitizeRegistrationPendingShopRequest(pendingShopRequest)
  if (!form) return ''

  return form.branch ? `${form.shopName} (${form.branch})` : form.shopName
}

export function matchesRegistrationPendingShopSelection(
  shopValue?: string | null,
  pendingShopRequest?: RegistrationPendingShopRequest | null,
) {
  const form = sanitizeRegistrationPendingShopRequest(pendingShopRequest)
  if (!form) return false

  const normalizedShopValue = normalizeLabel(shopValue)
  if (!normalizedShopValue) return false

  const displayName = getRegistrationPendingShopDisplayName(form)
  const allowedShopNames = new Set([
    normalizeLabel(displayName),
    normalizeLabel(form.shopName),
  ].filter(Boolean))

  return allowedShopNames.has(normalizedShopValue)
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
  pendingShopRequest?: RegistrationPendingShopRequest | null,
) {
  const normalizedShopValue = shopValue?.trim() || ''
  const normalizedShopOrganizationId = shopOrganizationId?.trim() || ''
  const sanitizedPendingShopRequest = sanitizeRegistrationPendingShopRequest(pendingShopRequest)

  if (!normalizedShopValue && !sanitizedPendingShopRequest) return SIGNUP_SHOP_REQUIRED_MESSAGE

  if (normalizedShopOrganizationId) return null
  if (matchesRegistrationPendingShopSelection(shopValue, sanitizedPendingShopRequest)) return null

  return INVALID_SIGNUP_SHOP_SELECTION_MESSAGE
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
    input.pendingShopRequest,
  )

  return {
    referenceError,
    shopError,
    isValid: !referenceError && !shopError,
  }
}