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
  getRegistrationPendingShopDisplayName,
  getRegistrationShopSelectionError,
  matchesRegistrationPendingShopSelection,
  sanitizeRegistrationPendingShopRequest,
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

  it('accepts a prepared new-shop draft when the displayed shop value still matches it', () => {
    const pendingShopRequest = {
      shopName: 'kedai baru',
      branch: 'ampang',
      contactName: 'Ali',
      contactPhone: '0123456789',
    }

    expect(sanitizeRegistrationPendingShopRequest(pendingShopRequest)).toEqual({
      shopName: 'Kedai Baru',
      branch: 'Ampang',
      contactName: 'Ali',
      contactPhone: '+60123456789',
      contactEmail: null,
      address: null,
      state: null,
      hotFlavourBrands: null,
      sellsSerapodFlavour: false,
      sellsSbox: false,
      sellsSboxSpecialEdition: false,
      notes: null,
    })

    expect(getRegistrationPendingShopDisplayName(pendingShopRequest)).toBe('Kedai Baru (Ampang)')
    expect(matchesRegistrationPendingShopSelection('Kedai Baru (Ampang)', pendingShopRequest)).toBe(true)
    expect(getRegistrationShopSelectionError('Kedai Baru (Ampang)', null, pendingShopRequest)).toBeNull()
    expect(validateRegistrationLinkSelections({
      referenceValue: '0123456789',
      referenceUserId: 'ref-1',
      shopValue: 'Kedai Baru (Ampang)',
      shopOrganizationId: null,
      pendingShopRequest,
    }).shopError).toBeNull()
  })

  it('rejects edited shop text after a prepared draft is no longer an exact match', () => {
    const pendingShopRequest = {
      shopName: 'Kedai Baru',
      branch: 'Ampang',
      contactName: 'Ali',
      contactPhone: '0123456789',
    }

    expect(matchesRegistrationPendingShopSelection('Kedai Baru (Ampang) X', pendingShopRequest)).toBe(false)
    expect(getRegistrationShopSelectionError('Kedai Baru (Ampang) X', null, pendingShopRequest)).toBe(INVALID_SIGNUP_SHOP_SELECTION_MESSAGE)
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