import { describe, expect, it } from 'vitest'
import { parseOutdoorBuyNow } from '@/lib/outdoor/buy-now'

describe('outdoor buy now item', () => {
  it('reads a saved item', () => {
    const raw = JSON.stringify({
      productId: 'p1',
      variantId: 'v1',
      productName: 'Moon Chair',
      variantName: 'Burgundy',
      price: 159,
      imageUrl: '/outdoor/products/chair-burgundy.png',
      quantity: 2,
    })
    expect(parseOutdoorBuyNow(raw)).toEqual({
      productId: 'p1',
      variantId: 'v1',
      productName: 'Moon Chair',
      variantName: 'Burgundy',
      price: 159,
      imageUrl: '/outdoor/products/chair-burgundy.png',
      quantity: 2,
    })
  })

  it('rejects missing or broken data', () => {
    expect(parseOutdoorBuyNow(null)).toBeNull()
    expect(parseOutdoorBuyNow('not json')).toBeNull()
    expect(parseOutdoorBuyNow(JSON.stringify({ productId: 'p1', productName: 'x', quantity: 1 }))).toBeNull()
    expect(parseOutdoorBuyNow(JSON.stringify({ productId: 'p1', variantId: 'v1', productName: 'x', quantity: 0 }))).toBeNull()
  })
})
