import { describe, expect, it } from 'vitest'
import {
  outdoorAuthHref,
  outdoorReturnPathFromLocation,
  sanitizeOutdoorReturnPath,
} from '@/lib/outdoor/auth-return'

describe('outdoor auth return path', () => {
  it('keeps the shopper on the Outdoor page they left', () => {
    expect(sanitizeOutdoorReturnPath('/outdoor/shop?color=burgundy')).toBe('/outdoor/shop?color=burgundy')
    expect(outdoorReturnPathFromLocation('/outdoor/products/moonchair', '')).toBe('/outdoor/products/moonchair')
    expect(outdoorAuthHref('login', '/outdoor/cart', '')).toBe('/outdoor/login?next=%2Foutdoor%2Fcart')
  })

  it('does not bounce back to login, register, or a non-Outdoor path', () => {
    expect(sanitizeOutdoorReturnPath('/outdoor/login')).toBe('/outdoor')
    expect(sanitizeOutdoorReturnPath('/outdoor/unsubscribe?token=abc')).toBe('/outdoor')
    expect(outdoorAuthHref('login', '/outdoor/unsubscribe', '?token=abc')).toBe('/outdoor/login?next=%2Foutdoor')
    expect(sanitizeOutdoorReturnPath('/dashboard')).toBe('/outdoor')
    expect(outdoorReturnPathFromLocation('/outdoor/login', '?next=%2Foutdoor%2Fcheckout')).toBe('/outdoor/checkout')
  })
})
