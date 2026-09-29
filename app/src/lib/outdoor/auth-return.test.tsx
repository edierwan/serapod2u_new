import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  outdoorAuthHref,
  outdoorPublicOrigin,
  outdoorReturnPathFromLocation,
  sanitizeOutdoorReturnPath,
} from '@/lib/outdoor/auth-return'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('outdoor public origin in the browser', () => {
  it('keeps social sign-in on outdoor.serapod2u.com when the shopper is there', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://serapod2u.com')
    vi.stubGlobal('window', { location: { hostname: 'outdoor.serapod2u.com', origin: 'https://outdoor.serapod2u.com' } })
    expect(outdoorPublicOrigin()).toBe('https://outdoor.serapod2u.com')
  })

  it('uses the app address on the main domain, as before', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://serapod2u.com')
    vi.stubGlobal('window', { location: { hostname: 'serapod2u.com', origin: 'https://serapod2u.com' } })
    expect(outdoorPublicOrigin()).toBe('https://serapod2u.com')
  })
})

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
