import { describe, expect, it } from 'vitest'

import {
  buildPersonalBankUpdateData,
  resolveMobilePersonalBankDetails,
  validateMsiaBankAccount,
} from './personal-bank-details'

describe('personal-bank-details', () => {
  it('loads personal bank details from the user row even when the user is shop-linked', () => {
    expect(resolveMobilePersonalBankDetails({
      bank_id: 'bank-1',
      bank_account_number: '557175482611',
      bank_account_holder_name: 'Muhammad Safwan Bin Abdullah',
      msia_banks: {
        id: 'bank-1',
        short_name: 'Maybank',
      },
    })).toEqual({
      bankId: 'bank-1',
      bankName: 'Maybank',
      bankAccountNumber: '557175482611',
      bankAccountHolderName: 'Muhammad Safwan Bin Abdullah',
    })
  })

  it('builds personal bank updates for users without organization-only fields', () => {
    expect(buildPersonalBankUpdateData({
      bankId: 'bank-1',
      bankAccountNumber: '557175482611',
      bankAccountHolderName: 'Muhammad Safwan Bin Abdullah',
    })).toEqual({
      bank_id: 'bank-1',
      bank_account_number: '557175482611',
      bank_account_holder_name: 'Muhammad Safwan Bin Abdullah',
    })
  })

  it('accepts Maybank account 557175482611 under the production bank rules', () => {
    expect(validateMsiaBankAccount({
      id: 'bank-1',
      short_name: 'Maybank',
      min_account_length: 12,
      max_account_length: 12,
      is_numeric_only: true,
      is_active: true,
    }, '557175482611')).toBe(true)
  })
})
