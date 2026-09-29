import { describe, expect, it } from 'vitest'
import { isCanonicalStaff } from './staff'

const employee = { principal_type: 'INTERNAL_EMPLOYEE', is_active: true, account_status: 'ACTIVE' }

describe('isCanonicalStaff (legacy role level is never proof of staff)', () => {
  it('accepts an active internal employee within the level ceiling', () => {
    expect(isCanonicalStaff(employee, 40)).toBe(true)
    expect(isCanonicalStaff(employee, 10, 20)).toBe(true)
  })

  it('keeps the legacy level as a narrowing ceiling', () => {
    expect(isCanonicalStaff(employee, 40, 20)).toBe(false)
    expect(isCanonicalStaff(employee, 50)).toBe(false)
    expect(isCanonicalStaff(employee, null)).toBe(false)
  })

  it.each(['CONSUMER', 'SHOP_STAFF', 'MANUFACTURER_USER', 'DISTRIBUTOR_USER', undefined])(
    'rejects %s even with a USER/HQ-level legacy role', (principal) => {
      expect(isCanonicalStaff({ ...employee, principal_type: principal }, 40)).toBe(false)
      expect(isCanonicalStaff({ ...employee, principal_type: principal }, 10)).toBe(false)
    })

  it.each(['SUSPENDED', 'DISABLED', 'ARCHIVED'])('rejects a %s account', (status) => {
    expect(isCanonicalStaff({ ...employee, account_status: status }, 10)).toBe(false)
  })

  it('rejects an inactive or missing profile', () => {
    expect(isCanonicalStaff({ ...employee, is_active: false }, 10)).toBe(false)
    expect(isCanonicalStaff(null, 10)).toBe(false)
  })
})
