import { describe, expect, it } from 'vitest'

import {
  SIGNUP_CONFIRM_PASSWORD_REQUIRED_MESSAGE,
  SIGNUP_PASSWORD_MIN_LENGTH_MESSAGE,
  SIGNUP_PASSWORD_REQUIRED_MESSAGE,
  SIGNUP_PASSWORDS_DO_NOT_MATCH_MESSAGE,
  SIGNUP_PASSWORDS_MATCH_MESSAGE,
  SIGNUP_REFERENCE_REQUIRED_MESSAGE,
  SIGNUP_SHOP_REQUIRED_MESSAGE,
  INVALID_SIGNUP_REFERENCE_SELECTION_MESSAGE,
  INVALID_SIGNUP_SHOP_SELECTION_MESSAGE,
  validateRegistrationPasswordFields,
  validateRegistrationLinkSelections,
} from './registration-link-selection'

describe('validateRegistrationLinkSelections', () => {
  it('requires both reference and shop selections', () => {
    expect(validateRegistrationLinkSelections({
      referenceValue: '',
      referenceUserId: null,
      shopValue: '',
      shopOrganizationId: null,
    })).toEqual({
      referenceError: SIGNUP_REFERENCE_REQUIRED_MESSAGE,
      shopError: SIGNUP_SHOP_REQUIRED_MESSAGE,
      isValid: false,
    })
  })

  it('rejects typed values without stable selected ids', () => {
    expect(validateRegistrationLinkSelections({
      referenceValue: '+60123456789',
      referenceUserId: null,
      shopValue: 'Kedai Baru',
      shopOrganizationId: null,
    })).toEqual({
      referenceError: INVALID_SIGNUP_REFERENCE_SELECTION_MESSAGE,
      shopError: INVALID_SIGNUP_SHOP_SELECTION_MESSAGE,
      isValid: false,
    })
  })

  it('accepts only canonical selections with both ids present', () => {
    expect(validateRegistrationLinkSelections({
      referenceValue: '+60123456789',
      referenceUserId: 'ref-123',
      shopValue: 'Kedai Maju (HQ)',
      shopOrganizationId: 'shop-123',
    })).toEqual({
      referenceError: null,
      shopError: null,
      isValid: true,
    })
  })
})

describe('validateRegistrationPasswordFields', () => {
  it('requires password and confirm password', () => {
    expect(validateRegistrationPasswordFields('', '')).toEqual({
      passwordError: SIGNUP_PASSWORD_REQUIRED_MESSAGE,
      confirmPasswordError: SIGNUP_CONFIRM_PASSWORD_REQUIRED_MESSAGE,
      confirmPasswordSuccess: null,
      isValid: false,
    })
  })

  it('rejects short passwords before submit', () => {
    expect(validateRegistrationPasswordFields('12345', '12345')).toEqual({
      passwordError: SIGNUP_PASSWORD_MIN_LENGTH_MESSAGE,
      confirmPasswordError: null,
      confirmPasswordSuccess: null,
      isValid: false,
    })
  })

  it('shows mismatch for different passwords', () => {
    expect(validateRegistrationPasswordFields('secret123', 'secret321')).toEqual({
      passwordError: null,
      confirmPasswordError: SIGNUP_PASSWORDS_DO_NOT_MATCH_MESSAGE,
      confirmPasswordSuccess: null,
      isValid: false,
    })
  })

  it('shows success when the passwords match', () => {
    expect(validateRegistrationPasswordFields('secret123', 'secret123')).toEqual({
      passwordError: null,
      confirmPasswordError: null,
      confirmPasswordSuccess: SIGNUP_PASSWORDS_MATCH_MESSAGE,
      isValid: true,
    })
  })
})