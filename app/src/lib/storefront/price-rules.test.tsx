import { describe, expect, it } from 'vitest'
import { customerPaymentError, isSellablePrice, retailPriceError } from '@/lib/storefront/price-rules'

describe('retail price rules', () => {
  it('allows an empty or zero price (not sold online)', () => {
    expect(retailPriceError(null)).toBeNull()
    expect(retailPriceError(undefined)).toBeNull()
    expect(retailPriceError(0)).toBeNull()
  })

  it('rejects prices the card gateway cannot charge', () => {
    expect(retailPriceError(0.1)).toMatch(/at least RM 2\.00/)
    expect(retailPriceError(1.99)).toMatch(/at least RM 2\.00/)
    expect(retailPriceError(-5)).toMatch(/positive/)
  })

  it('accepts RM 2.00 and above', () => {
    expect(retailPriceError(2)).toBeNull()
    expect(retailPriceError(89.9)).toBeNull()
    expect(isSellablePrice(2)).toBe(true)
    expect(isSellablePrice(0.1)).toBe(false)
    expect(isSellablePrice(null)).toBe(false)
  })

  it('never shows raw gateway errors to customers', () => {
    const raw = 'Stripe API 400: {"error":{"code":"amount_too_small","message":"must add up to at least RM2.00 MYR"}}'
    expect(customerPaymentError(raw)).toBe('The order total must be at least RM 2.00 to pay online.')
    expect(customerPaymentError('Stripe API 500: boom')).not.toMatch(/Stripe|500/)
  })
})
