import { describe, expect, it } from 'vitest'
import { isOutdoorUpdateKind, outdoorUpdateLabel, outdoorUpdateLink } from './newsletter-updates'

describe('outdoor newsletter updates', () => {
  it('knows the offer and free-shipping types', () => {
    expect(isOutdoorUpdateKind('offer')).toBe(true)
    expect(isOutdoorUpdateKind('shipping')).toBe(true)
    expect(isOutdoorUpdateKind('spam')).toBe(false)
    expect(outdoorUpdateLabel('shipping')).toBe('Free shipping')
    expect(outdoorUpdateLabel('unknown')).toBe('Update')
  })

  it('turns an empty link into no link and a path into a full address', () => {
    expect(outdoorUpdateLink('', 'https://shop.test')).toEqual({ url: '' })
    expect(outdoorUpdateLink(' /outdoor/shop/a ', 'https://shop.test/')).toEqual({ url: 'https://shop.test/outdoor/shop/a' })
    expect(outdoorUpdateLink('https://example.com/x', 'https://shop.test').url).toBe('https://example.com/x')
  })

  it('refuses links that are not plain web addresses', () => {
    expect(outdoorUpdateLink('javascript:alert(1)', 'https://shop.test').error).toBeTruthy()
    expect(outdoorUpdateLink('//evil.test/x', 'https://shop.test').error).toBeTruthy()
    expect(outdoorUpdateLink('not a link', 'https://shop.test').error).toBeTruthy()
  })
})
