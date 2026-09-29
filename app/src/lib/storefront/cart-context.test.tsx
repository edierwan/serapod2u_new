import { describe, expect, it } from 'vitest'
import { accountCartKey, mergeCartItems, type CartItem } from '@/lib/storefront/cart-context'

const item = (variantId: string, quantity: number): CartItem => ({
  productId: 'p1',
  variantId,
  productName: 'Moon Chair',
  variantName: variantId,
  price: 80,
  imageUrl: null,
  quantity,
})

describe('account-scoped bag', () => {
  it('keeps the guest bag and each account bag under different keys', () => {
    expect(accountCartKey('serapod_outdoor_cart', null)).toBe('serapod_outdoor_cart')
    expect(accountCartKey('serapod_outdoor_cart', 'u1')).toBe('serapod_outdoor_cart:user:u1')
    expect(accountCartKey('serapod_outdoor_cart', 'u2')).not.toBe(accountCartKey('serapod_outdoor_cart', 'u1'))
  })

  it('moves guest items into the account bag without doubling the same item', () => {
    const merged = mergeCartItems([item('red', 1), item('blue', 2)], [item('blue', 1), item('grey', 3)])
    expect(merged.map((i) => [i.variantId, i.quantity])).toEqual([
      ['red', 1],
      ['blue', 2],
      ['grey', 3],
    ])
  })

  it('does not change the inputs', () => {
    const account = [item('red', 1)]
    mergeCartItems(account, [item('red', 4)])
    expect(account[0].quantity).toBe(1)
  })
})
