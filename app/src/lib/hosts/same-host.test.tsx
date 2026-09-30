import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { sameHostOrigin } from './same-host'
import { sameHostOriginFromRequest } from '@/lib/http/public-origin'
import { oauthReturnOrigin } from '@/lib/outdoor/auth-return'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('sameHostOrigin', () => {
  it('moves to the www / bare twin the user is on', () => {
    expect(sameHostOrigin('https://www.serapod2u.com', 'serapod2u.com')).toBe('https://serapod2u.com')
    expect(sameHostOrigin('https://serapod2u.com', 'www.serapod2u.com')).toBe('https://www.serapod2u.com')
    expect(sameHostOrigin('https://www.serapod2u.com', 'SERAPOD2U.com:443')).toBe('https://serapod2u.com')
  })

  it('never moves to an unrelated host', () => {
    expect(sameHostOrigin('https://www.serapod2u.com', 'evil.example.com')).toBe('https://www.serapod2u.com')
    expect(sameHostOrigin('https://www.serapod2u.com', 'serapod2u.com.evil.io')).toBe('https://www.serapod2u.com')
    expect(sameHostOrigin('https://stg.serapod2u.com', 'serapod2u.com')).toBe('https://stg.serapod2u.com')
  })

  it('keeps the configured origin when the host matches or is unknown', () => {
    expect(sameHostOrigin('https://stg.serapod2u.com', 'stg.serapod2u.com')).toBe('https://stg.serapod2u.com')
    expect(sameHostOrigin('http://localhost:3000', 'localhost')).toBe('http://localhost:3000')
    expect(sameHostOrigin('https://www.serapod2u.com', '')).toBe('https://www.serapod2u.com')
  })
})

describe('sign-in return host', () => {
  it('finishes a server-side sign-in on the host the request came to', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.serapod2u.com')
    const bare = new NextRequest('https://serapod2u.com/auth/callback', { headers: { host: 'serapod2u.com' } })
    const www = new NextRequest('https://www.serapod2u.com/auth/callback', { headers: { host: 'www.serapod2u.com' } })
    expect(sameHostOriginFromRequest(bare)).toBe('https://serapod2u.com')
    expect(sameHostOriginFromRequest(www)).toBe('https://www.serapod2u.com')
  })

  it('keeps the Outdoor host for Outdoor sign-ins', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.serapod2u.com')
    const outdoor = new NextRequest('https://outdoor.serapod2u.com/auth/callback', { headers: { host: 'outdoor.serapod2u.com' } })
    expect(sameHostOriginFromRequest(outdoor)).toBe('https://outdoor.serapod2u.com')
  })

  it('sends Google back to serapod2u.com when the button was pressed there', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.serapod2u.com')
    vi.stubGlobal('window', { location: { hostname: 'serapod2u.com', origin: 'https://serapod2u.com' } })
    expect(oauthReturnOrigin()).toBe('https://serapod2u.com')
    vi.stubGlobal('window', { location: { hostname: 'www.serapod2u.com', origin: 'https://www.serapod2u.com' } })
    expect(oauthReturnOrigin()).toBe('https://www.serapod2u.com')
  })
})
