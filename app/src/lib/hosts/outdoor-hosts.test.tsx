import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { isOutdoorHost } from './outdoor-hosts'
import { resolveMarketingHostRewrite } from './site-hosts'
import { publicOriginFromRequest } from '@/lib/http/public-origin'
import { outdoorPublicOrigin } from '@/lib/outdoor/product-email'

const request = (url: string, host?: string) =>
  new NextRequest(url, { headers: host ? { host } : {} })

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Outdoor store host', () => {
  it('recognises outdoor.serapod2u.com and nothing else on the main domain', () => {
    expect(isOutdoorHost('outdoor.serapod2u.com')).toBe(true)
    expect(isOutdoorHost('OUTDOOR.serapod2u.com:443')).toBe(true)
    expect(isOutdoorHost('www.outdoor.serapod2u.com')).toBe(true)
    expect(isOutdoorHost('serapod2u.com')).toBe(false)
    expect(isOutdoorHost('stg.serapod2u.com')).toBe(false)
    expect(isOutdoorHost('')).toBe(false)
  })

  it('opens the store at the root of outdoor.serapod2u.com', () => {
    const home = resolveMarketingHostRewrite(request('https://outdoor.serapod2u.com/', 'outdoor.serapod2u.com'))
    expect(home?.headers.get('x-middleware-rewrite')).toBe('https://outdoor.serapod2u.com/outdoor')
    const shop = resolveMarketingHostRewrite(request('https://outdoor.serapod2u.com/shop', 'outdoor.serapod2u.com'))
    expect(shop?.headers.get('x-middleware-rewrite')).toBe('https://outdoor.serapod2u.com/outdoor/shop')
  })

  it('leaves /outdoor, API and sign-in callback paths alone on the store host', () => {
    for (const path of ['/outdoor/cart', '/api/storefront/checkout', '/auth/callback']) {
      expect(resolveMarketingHostRewrite(request(`https://outdoor.serapod2u.com${path}`, 'outdoor.serapod2u.com'))).toBeNull()
    }
  })

  it('does not touch the main app domains', () => {
    expect(resolveMarketingHostRewrite(request('https://serapod2u.com/', 'serapod2u.com'))).toBeNull()
    expect(resolveMarketingHostRewrite(request('https://stg.serapod2u.com/', 'stg.serapod2u.com'))).toBeNull()
  })
})

describe('public origin', () => {
  it('keeps the Outdoor host for requests that arrive on it', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://serapod2u.com')
    expect(publicOriginFromRequest(request('https://outdoor.serapod2u.com/api/x', 'outdoor.serapod2u.com'))).toBe('https://outdoor.serapod2u.com')
  })

  it('still uses the app address for every other host', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://serapod2u.com')
    expect(publicOriginFromRequest(request('https://serapod2u.com/api/x', 'serapod2u.com'))).toBe('https://serapod2u.com')
    expect(publicOriginFromRequest()).toBe('https://serapod2u.com')
  })
})

describe('Outdoor email links', () => {
  it('use OUTDOOR_SITE_URL when production sets it', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://serapod2u.com')
    vi.stubEnv('OUTDOOR_SITE_URL', 'https://outdoor.serapod2u.com/')
    expect(outdoorPublicOrigin()).toBe('https://outdoor.serapod2u.com')
  })

  it('keep today\'s app address when OUTDOOR_SITE_URL is not set', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://stg.serapod2u.com')
    vi.stubEnv('OUTDOOR_SITE_URL', '')
    expect(outdoorPublicOrigin()).toBe('https://stg.serapod2u.com')
  })
})
