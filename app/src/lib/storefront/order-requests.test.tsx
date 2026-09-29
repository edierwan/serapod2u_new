import { describe, expect, it } from 'vitest'
import {
  canMoveOrderRequest,
  canRaiseOrderRequest,
  isOpenOrderRequest,
  validateOrderRequestInput,
} from '@/lib/storefront/order-requests'

describe('storefront order requests', () => {
  it('only allows requests on paid orders onwards', () => {
    expect(canRaiseOrderRequest('pending_payment')).toBe(false)
    expect(canRaiseOrderRequest('payment_failed')).toBe(false)
    expect(canRaiseOrderRequest('cancelled')).toBe(false)
    expect(canRaiseOrderRequest('paid')).toBe(true)
    expect(canRaiseOrderRequest('delivered')).toBe(true)
  })

  it('follows the review then refund path', () => {
    expect(canMoveOrderRequest('new', 'reviewing')).toBe(true)
    expect(canMoveOrderRequest('reviewing', 'approved')).toBe(true)
    expect(canMoveOrderRequest('approved', 'refunded')).toBe(true)
    expect(canMoveOrderRequest('new', 'refunded')).toBe(false)
    expect(canMoveOrderRequest('rejected', 'approved')).toBe(false)
    expect(canMoveOrderRequest('refunded', 'closed')).toBe(false)
    expect(canMoveOrderRequest('new', 'unknown')).toBe(false)
  })

  it('treats new, reviewing, and approved as open', () => {
    expect(isOpenOrderRequest('new')).toBe(true)
    expect(isOpenOrderRequest('approved')).toBe(true)
    expect(isOpenOrderRequest('rejected')).toBe(false)
    expect(isOpenOrderRequest('refunded')).toBe(false)
  })

  it('checks the customer form', () => {
    expect(validateOrderRequestInput({ type: 'nope', message: 'long enough text', photoCount: 0 })).toBe('Choose what happened.')
    expect(validateOrderRequestInput({ type: 'return', message: 'short', photoCount: 0 })).toMatch(/at least/)
    expect(validateOrderRequestInput({ type: 'damaged', message: 'The lid is cracked', photoCount: 0 })).toMatch(/photo/)
    expect(validateOrderRequestInput({ type: 'damaged', message: 'The lid is cracked', photoCount: 1 })).toBeNull()
    expect(validateOrderRequestInput({ type: 'return', message: 'Changed my mind please', photoCount: 0 })).toBeNull()
    expect(validateOrderRequestInput({ type: 'other', message: 'Too many photos here', photoCount: 5 })).toMatch(/up to/)
  })
})
