import { describe, expect, it } from 'vitest'
import { normalizeMalaysianPhone, validateCheckoutCustomer } from '@/lib/storefront/customer-validation'

const valid = {
  name: 'Jafar Ali',
  phone: '011-6373 9729',
  addressLine1: 'Residensi Pauh Permai, Jalan 3',
  addressLine2: '',
  city: 'Bukit Mertajam',
  state: 'Penang',
  postcode: '13500',
}

describe('normalizeMalaysianPhone', () => {
  it('accepts local and international mobile formats', () => {
    expect(normalizeMalaysianPhone('012-345 6789')).toBe('+60123456789')
    expect(normalizeMalaysianPhone('+601163739729')).toBe('+601163739729')
    expect(normalizeMalaysianPhone('601163739729')).toBe('+601163739729')
  })

  it('accepts landlines', () => {
    expect(normalizeMalaysianPhone('03-2345 6789')).toBe('+60323456789')
    expect(normalizeMalaysianPhone('04-123 4567')).toBe('+6041234567')
  })

  it('rejects letters, short numbers, and foreign numbers', () => {
    expect(normalizeMalaysianPhone('01234abcde')).toBeNull()
    expect(normalizeMalaysianPhone('01234')).toBeNull()
    expect(normalizeMalaysianPhone('+6591234567')).toBeNull()
    expect(normalizeMalaysianPhone('')).toBeNull()
  })
})

describe('validateCheckoutCustomer', () => {
  it('passes a complete Malaysian address', () => {
    expect(validateCheckoutCustomer(valid)).toEqual({})
  })

  it('allows common Malaysian name forms', () => {
    expect(validateCheckoutCustomer({ ...valid, name: "Muthu A/L Rajan" }).name).toBeUndefined()
    expect(validateCheckoutCustomer({ ...valid, name: 'Siti binti Abdullah' }).name).toBeUndefined()
    expect(validateCheckoutCustomer({ ...valid, name: "O'Neil-Tan" }).name).toBeUndefined()
  })

  it('flags names and cities with digits', () => {
    const errors = validateCheckoutCustomer({ ...valid, name: 'asd123', city: '12345' })
    expect(errors.name).toBeDefined()
    expect(errors.city).toBeDefined()
  })

  it('flags a bad phone, address, state, and postcode', () => {
    const errors = validateCheckoutCustomer({ ...valid, phone: 'abc', addressLine1: '12', state: 'Texas', postcode: '1350' })
    expect(Object.keys(errors).sort()).toEqual(['addressLine1', 'phone', 'postcode', 'state'])
  })
})
