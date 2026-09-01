import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { requireCronAuth } from './auth'

const SECRET = 'super-secret-cron-value'

function req(authorization?: string): NextRequest {
  const headers = new Headers()
  if (authorization !== undefined) headers.set('authorization', authorization)
  return new NextRequest('https://example.test/api/cron/whatever', { headers })
}

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.NODE_ENV = 'production'
  process.env.CRON_SECRET = SECRET
  delete process.env.WORKER_SECRET
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('requireCronAuth', () => {
  it('rejects a request with NO Authorization header (the removed bypass)', async () => {
    const res = requireCronAuth(req(), 'w')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
    await expect(res!.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('rejects a wrong secret', () => {
    expect(requireCronAuth(req('Bearer not-the-secret'), 'w')?.status).toBe(401)
  })

  it('rejects a secret that is a prefix of the real one (length-safe compare)', () => {
    expect(requireCronAuth(req(`Bearer ${SECRET.slice(0, -1)}`), 'w')?.status).toBe(401)
  })

  it('accepts the correct secret', () => {
    expect(requireCronAuth(req(`Bearer ${SECRET}`), 'w')).toBeNull()
  })

  it('accepts a case-insensitive bearer scheme', () => {
    expect(requireCronAuth(req(`bearer ${SECRET}`), 'w')).toBeNull()
  })

  it('rejects a non-bearer scheme carrying the right value', () => {
    expect(requireCronAuth(req(`Basic ${SECRET}`), 'w')?.status).toBe(401)
  })

  it('rejects a bare token with no scheme', () => {
    expect(requireCronAuth(req(SECRET), 'w')?.status).toBe(401)
  })

  it('rejects an empty bearer token', () => {
    expect(requireCronAuth(req('Bearer '), 'w')?.status).toBe(401)
  })

  it('FAILS CLOSED in production when no secret is configured', () => {
    delete process.env.CRON_SECRET
    expect(requireCronAuth(req(`Bearer ${SECRET}`), 'w')?.status).toBe(401)
    expect(requireCronAuth(req(), 'w')?.status).toBe(401)
  })

  it('falls back to WORKER_SECRET for backwards compatibility', () => {
    delete process.env.CRON_SECRET
    process.env.WORKER_SECRET = SECRET
    expect(requireCronAuth(req(`Bearer ${SECRET}`), 'w')).toBeNull()
    expect(requireCronAuth(req('Bearer nope'), 'w')?.status).toBe(401)
  })

  it('still enforces a configured secret outside production', () => {
    process.env.NODE_ENV = 'development'
    expect(requireCronAuth(req(), 'w')?.status).toBe(401)
    expect(requireCronAuth(req(`Bearer ${SECRET}`), 'w')).toBeNull()
  })

  it('only allows an unauthenticated run outside production when NO secret is configured', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.CRON_SECRET
    expect(requireCronAuth(req(), 'w')).toBeNull()
  })

  it('never echoes the supplied credential in the response body', async () => {
    const res = requireCronAuth(req('Bearer leaked-token-value'), 'w')
    await expect(res!.json()).resolves.toEqual({ error: 'Unauthorized' })
  })
})
