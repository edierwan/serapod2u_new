import { MALAYSIA_STATES } from '@/lib/shipping/malaysia-states'

export type CheckoutCustomerFields = {
  name: string
  phone: string
  addressLine1: string
  addressLine2?: string
  city: string
  state: string
  postcode: string
}

export type CheckoutFieldErrors = Partial<Record<keyof CheckoutCustomerFields, string>>

const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'’\-\/@]*$/u
const CITY_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'’\-]*$/u

/**
 * Malaysian mobile (01x, 10–11 digits) or landline (03–09, 9–10 digits), with or
 * without +60 / 60. Returns +60… so couriers get one format, or null when invalid.
 */
export function normalizeMalaysianPhone(raw: string | null | undefined): string | null {
  const compact = String(raw || '').trim().replace(/[\s\-().]/g, '')
  if (!/^\+?\d+$/.test(compact)) return null
  let national = compact.replace(/^\+/, '')
  if (national.startsWith('60')) national = `0${national.slice(2)}`
  if (!national.startsWith('0')) return null
  const mobile = /^01\d{8,9}$/.test(national)
  const landline = /^0[3-9]\d{7,8}$/.test(national)
  if (!mobile && !landline) return null
  return `+60${national.slice(1)}`
}

export function validateCheckoutCustomer(customer: Partial<CheckoutCustomerFields>): CheckoutFieldErrors {
  const errors: CheckoutFieldErrors = {}
  const name = String(customer.name || '').trim()
  const address1 = String(customer.addressLine1 || '').trim()
  const address2 = String(customer.addressLine2 || '').trim()
  const city = String(customer.city || '').trim()
  const state = String(customer.state || '').trim()
  const postcode = String(customer.postcode || '').trim()

  if (name.length < 2 || name.length > 80 || !NAME_PATTERN.test(name)) {
    errors.name = 'Enter your full name using letters only.'
  }
  if (!normalizeMalaysianPhone(customer.phone)) {
    errors.phone = 'Enter a valid Malaysian phone number, e.g. 012-345 6789.'
  }
  if (address1.length < 5 || address1.length > 200 || !/\p{L}/u.test(address1)) {
    errors.addressLine1 = 'Enter your street address (house number and street).'
  }
  if (address2.length > 200) {
    errors.addressLine2 = 'Address line 2 is too long.'
  }
  if (city.length < 2 || city.length > 60 || !CITY_PATTERN.test(city)) {
    errors.city = 'Enter a city name using letters only.'
  }
  if (!MALAYSIA_STATES.some((s) => s.label === state)) {
    errors.state = 'Select your state.'
  }
  if (!/^\d{5}$/.test(postcode)) {
    errors.postcode = 'Enter a 5-digit postcode.'
  }
  return errors
}
