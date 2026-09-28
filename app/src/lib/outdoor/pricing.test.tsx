import { describe, expect, it } from 'vitest'
import { hasPricedVariant, isOutdoorPriced } from '@/lib/outdoor/pricing'

describe('outdoor pricing visibility', () => {
  it('shows products with a price above zero', () => {
    expect(isOutdoorPriced({ display_price: 89, starting_price: 89 })).toBe(true)
    expect(isOutdoorPriced({ display_price: null, starting_price: 45 })).toBe(true)
  })

  it('hides products with no price or a zero price', () => {
    expect(isOutdoorPriced({ display_price: null, starting_price: null })).toBe(false)
    expect(isOutdoorPriced({ display_price: 0, starting_price: null })).toBe(false)
  })

  it('keeps a product page when at least one option has a price', () => {
    expect(hasPricedVariant([{ suggested_retail_price: 0 }, { suggested_retail_price: 120 }])).toBe(true)
    expect(hasPricedVariant([{ suggested_retail_price: 0 }, { suggested_retail_price: null }])).toBe(false)
    expect(hasPricedVariant([])).toBe(false)
  })
})
