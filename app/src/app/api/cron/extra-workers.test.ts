import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { LEASE_SKIPPED, WORKER_NAMES } from '@/lib/cron/lease'

/**
 * Follow-up security pass: the five extra worker/debug endpoints found by the
 * Phase 12 scan. No real database, no external side effects.
 */

const SECRET = 'test-cron-secret'

let leaseStore: Map<string, { owner: string; until: number }>
let leaseAcquiredCount: number
let sessionUser: { id: string } | null

function emptyQuery() {
  const builder: any = {
    select: () => builder,
    update: () => builder,
    insert: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    single: async () => ({ data: null, error: { code: 'PGRST116', message: 'no rows' } }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  }
  return builder
}

function leaseRpc() {
  return vi.fn(async (fn: string, args: Record<string, any>) => {
    if (fn === 'try_acquire_worker_lease') {
      const current = leaseStore.get(args.p_worker_name)
      if (current && current.until > Date.now()) return { data: false, error: null }
      leaseStore.set(args.p_worker_name, { owner: args.p_owner, until: Date.now() + args.p_ttl_seconds * 1000 })
      leaseAcquiredCount += 1
      return { data: true, error: null }
    }
    if (fn === 'release_worker_lease') {
      const current = leaseStore.get(args.p_worker_name)
      if (current && current.owner === args.p_owner) {
        leaseStore.delete(args.p_worker_name)
        return { data: true, error: null }
      }
      return { data: false, error: null }
    }
    return { data: null, error: null }
  })
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ rpc: leaseRpc(), from: () => emptyQuery(), storage: { from: () => ({}) } }),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: leaseRpc(), from: () => emptyQuery() }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser }, error: sessionUser ? null : new Error('no session') }) },
  }),
}))

function request(authorization?: string) {
  const headers = new Headers()
  if (authorization !== undefined) headers.set('authorization', authorization)
  return new NextRequest('https://example.test/api/cron/x?batchId=b1', { headers })
}

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  leaseStore = new Map()
  leaseAcquiredCount = 0
  sessionUser = null
  vi.stubEnv('NODE_ENV', 'production')
  process.env.CRON_SECRET = SECRET
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  delete process.env.WORKER_SECRET
})

afterEach(() => {
  vi.unstubAllEnvs()
  process.env = { ...originalEnv }
})

// ── legacy reverse workers: strict cron auth + shared qr-reverse lease ──────
const LEGACY = [
  { name: 'process-async-reverse', path: './process-async-reverse/route' },
  { name: 'manufacturer/reverse-job/worker', path: '../manufacturer/reverse-job/worker/route' },
] as const

describe.each(LEGACY)('$name (legacy reverse worker)', ({ path }) => {
  it('rejects a missing Authorization header', async () => {
    const { POST } = await import(path)
    expect((await POST(request())).status).toBe(401)
  })

  it('rejects a wrong secret', async () => {
    const { POST } = await import(path)
    expect((await POST(request('Bearer nope'))).status).toBe(401)
  })

  it('rejects the removed hardcoded dev-worker-secret fallback', async () => {
    const { POST } = await import(path)
    expect((await POST(request('Bearer dev-worker-secret'))).status).toBe(401)
  })

  it('accepts the correct secret', async () => {
    const { POST } = await import(path)
    expect((await POST(request(`Bearer ${SECRET}`))).status).toBe(200)
  })

  it('shares the qr-reverse lease name (same queue, so must not run alongside it)', async () => {
    // qr-reverse-worker already holds its lease
    leaseStore.set(WORKER_NAMES.qrReverse, { owner: 'qr-reverse-run', until: Date.now() + 60_000 })
    const { POST } = await import(path)
    const res = await POST(request(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ status: LEASE_SKIPPED })
    expect(leaseAcquiredCount).toBe(0)
  })
})

// ── debug endpoints: disabled in production ────────────────────────────────
const DEBUG = [
  { name: 'cron/warehouse-debug', path: './warehouse-debug/route' },
  { name: 'warehouse/debug-worker', path: '../warehouse/debug-worker/route' },
] as const

describe.each(DEBUG)('$name (debug endpoint)', ({ path }) => {
  it('is 404 in production even with a correct cron secret', async () => {
    const { GET } = await import(path)
    const res = await GET(request(`Bearer ${SECRET}`))
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Not Found' })
  })

  it('is 404 in production for an anonymous caller', async () => {
    const { GET } = await import(path)
    expect((await GET(request())).status).toBe(404)
  })

  it('outside production still requires the cron secret', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { GET } = await import(path)
    expect((await GET(request())).status).toBe(401)
  })

  it('outside production works with the correct secret (dev use preserved)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { GET } = await import(path)
    const res = await GET(request(`Bearer ${SECRET}`))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(404)
  })
})

// ── warehouse-receiving-worker: cron OR session, never anonymous ───────────
describe('warehouse-receiving-worker', () => {
  it('rejects an anonymous caller with no session', async () => {
    const { GET } = await import('./warehouse-receiving-worker/route')
    expect((await GET(request())).status).toBe(401)
  })

  it('rejects a wrong secret with no session', async () => {
    const { GET } = await import('./warehouse-receiving-worker/route')
    expect((await GET(request('Bearer nope'))).status).toBe(401)
  })

  it('accepts a correct cron secret', async () => {
    const { GET } = await import('./warehouse-receiving-worker/route')
    expect((await GET(request(`Bearer ${SECRET}`))).status).not.toBe(401)
  })

  it('accepts an authenticated browser session (the warehouse UI path)', async () => {
    sessionUser = { id: 'user-1' }
    const { GET } = await import('./warehouse-receiving-worker/route')
    expect((await GET(request())).status).not.toBe(401)
  })
})
