import { describe, expect, it } from 'vitest'

import {
  getDisallowedSelfServiceFields,
  pickSelfServiceProfileFields,
  SELF_SERVICE_AUTH_METADATA_FIELDS,
} from './user-profile-updates'

describe('self-service profile update policy', () => {
  it('allows the personal fields used by My Profile', () => {
    const input = {
      full_name: 'Liza',
      call_name: 'Liz',
      phone: '+60123456789',
      avatar_url: 'https://example.test/avatar.png',
      signature_url: 'https://example.test/signature.png',
      address: 'Kuala Lumpur',
      location: 'KL',
      shop_name: 'Example Shop',
      referral_phone: '+60111111111',
      bank_id: 'bank-id',
      bank_account_number: '1234567890',
      bank_account_holder_name: 'Liza Example',
    }

    expect(getDisallowedSelfServiceFields(input)).toEqual([])
    expect(pickSelfServiceProfileFields(input)).toEqual(input)
  })

  it.each([
    'role_code',
    'organization_id',
    'account_scope',
    'is_active',
    'department_id',
    'manager_user_id',
    'position_id',
    'employment_type',
    'join_date',
    'employment_status',
    'can_be_reference',
  ])('denies self-service changes to %s', (field) => {
    expect(getDisallowedSelfServiceFields({ [field]: 'attacker-value' })).toEqual([field])
  })

  it('drops unknown and protected fields when selecting the self-service payload', () => {
    expect(pickSelfServiceProfileFields({ full_name: 'Liza', role_code: 'SA', unknown: true }))
      .toEqual({ full_name: 'Liza' })
  })

  it('allows storefront Auth metadata only when the endpoint declares it', () => {
    const input = { outdoor_phone: '+60123456789', outdoor_location: 'Shah Alam' }

    expect(getDisallowedSelfServiceFields(input, SELF_SERVICE_AUTH_METADATA_FIELDS)).toEqual([])
    expect(getDisallowedSelfServiceFields(input)).toEqual(['outdoor_phone', 'outdoor_location'])
    expect(pickSelfServiceProfileFields(input)).toEqual({})
  })
})
