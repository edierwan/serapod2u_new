import { describe, expect, it } from 'vitest'

import {
  INVALID_SIGNUP_REFERENCE_SELECTION_MESSAGE,
  INVALID_SIGNUP_SHOP_SELECTION_MESSAGE,
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
      referenceError: INVALID_SIGNUP_REFERENCE_SELECTION_MESSAGE,
      shopError: INVALID_SIGNUP_SHOP_SELECTION_MESSAGE,
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