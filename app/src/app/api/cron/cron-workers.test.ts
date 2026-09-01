import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { LEASE_SKIPPED } from '@/lib/cron/lease'

/**
 * Auth + single-execution guarantees for all four internal cron workers.
 *
 * Nothing here touches a real database, and no SMS/email/WhatsApp is dispatched:
 * every worker body is short-circuited to "nothing to do" by the Supabase mock.
 */

const SECRET = 'test-cron-secret'

// ── lease state shared by the mocked supabase client ────────────────────────
let leaseStore: Map<string, { owner: string; until: number }>
/** Number of executions that actually took the lease, i.e. entered processing. */
let leaseAcquiredCount: number
/** Raw DB-call markers - a single run may make several, so this is not an execution count. */
let bodyEntries: string[]
/** Gate that holds a worker body open so an overlapping call can be observed. */
let bodyGate: Promise<void> | null
let openBodyGate: (() => void) | null

function markBodyEntered(worker: string) {
  bodyEntries.push(worker)
}

/** Chainable query builder that always resolves to "no rows". */
function emptyQuery(worker: string) {
  const settle = async () => {
    markBodyEntered(worker)
    if (bodyGate) await bodyGate
    return { data: [], error: null }
  }

  const builder: any = {
    select: () => builder,
    update: () => builder,
    insert: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    not: () => builder,
    order: () => builder,
    limit: () => builder,
    single: async () => {
      markBodyEntered(worker)
      if (bodyGate) await bodyGate
      return { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    },
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      settle().then(resolve, reject),
  }
  return builder
}

function makeSupabase(worker: string) {
  return {
    rpc: vi.fn(async (fn: string, args: Record<string, any>) => {
      if (fn === 'try_acquire_worker_lease') {
        const current = leaseStore.get(args.p_worker_name)
        if (current && current.until > Date.now()) return { data: false, error: null }
        leaseStore.set(args.p_worker_name, {
          owner: args.p_owner,
          until: Date.now() + args.p_ttl_seconds * 1000,
        })
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
      if (fn === 'get_pending_notifications') {
        markBodyEntered(worker)
        if (bodyGate) await bodyGate
        return { data: [], error: null }
      }
      return { data: null, error: null }
    }),
    from: () => emptyQuery(worker),
  }
}

let activeWorker = 'unknown'
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => makeSupabase(activeWorker),
}))

// Heavy collaborators the worker modules import at load time.
vi.mock('@/lib/qr-generator', () => ({ generateQRBatch: vi.fn() }))
vi.mock('@/lib/excel-generator', () => ({
  generateQRExcel: vi.fn(),
  generateQRExcelFilename: vi.fn(() => 'x.xlsx'),
}))
vi.mock('@/lib/notifications/supplyChainEventQueue', () => ({ queueNotificationEvent: vi.fn() }))
vi.mock('@/app/api/settings/whatsapp/_utils', () => ({
  getWhatsAppConfig: vi.fn(),
  callGateway: vi.fn(),
  sendWhatsAppMessage: vi.fn(),
}))
vi.mock('@/lib/notifications/recipientRoleCodes', () => ({
  expandNotificationRoleCodes: vi.fn(() => []),
}))
vi.mock('@/lib/email/smtp-endpoint', () => ({ resolveSmtpEndpoint: vi.fn() }))

const WORKERS = [
  { name: 'qr-reverse-worker', path: './qr-reverse-worker/route' },
  { name: 'qr-generation-worker', path: './qr-generation-worker/route' },
  { name: 'manufacturer-packing-worker', path: './manufacturer-packing-worker/route' },
  { name: 'notification-outbox-worker', path: './notification-outbox-worker/route' },
] as const

function request(authorization?: string) {
  const headers = new Headers()
  if (authorization !== undefined) headers.set('authorization', authorization)
  return new NextRequest('https://example.test/api/cron/worker', { headers })
}

async function loadGet(path: string) {
  const mod: any = await import(path)
  return mod.GET as (r: NextRequest) => Promise<Response>
}

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  leaseStore = new Map()
  leaseAcquiredCount = 0
  bodyEntries = []
  bodyGate = null
  openBodyGate = null
  process.env.NODE_ENV = 'production'
  process.env.CRON_SECRET = SECRET
  delete process.env.WORKER_SECRET
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe.each(WORKERS)('$name', ({ name, path }) => {
  beforeEach(() => {
    activeWorker = name
  })

  it('1. returns 401 with NO Authorization header', async () => {
    const GET = await loadGet(path)
    const res = await GET(request())
    expect(res.status).toBe(401)
    expect(bodyEntries).toHaveLength(0)
  })

  it('2. returns 401 with a wrong CRON_SECRET', async () => {
    const GET = await loadGet(path)
    const res = await GET(request('Bearer wrong-secret'))
    expect(res.status).toBe(401)
    expect(bodyEntries).toHaveLength(0)
  })

  it('3. accepts the correct CRON_SECRET', async () => {
    const GET = await loadGet(path)
    const res = await GET(request(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    expect(bodyEntries.length).toBeGreaterThan(0)
  })

  it('11-14. two concurrent authorized calls: only ONE enters processing', async () => {
    const GET = await loadGet(path)
    bodyGate = new Promise<void>((resolve) => {
      openBodyGate = resolve
    })

    const first = GET(request(`Bearer ${SECRET}`))
    // let the first call take the lease and reach the gated body
    await new Promise((r) => setTimeout(r, 0))
    const second = GET(request(`Bearer ${SECRET}`))
    await new Promise((r) => setTimeout(r, 0))

    openBodyGate!()
    const [res1, res2] = await Promise.all([first, second])

    // exactly ONE execution took the lease and entered processing
    // (bodyEntries counts DB calls, and a single run may make more than one)
    expect(leaseAcquiredCount).toBe(1)
    expect(bodyEntries.length).toBeGreaterThan(0)

    const bodies = await Promise.all([res1.json(), res2.json()])
    const skipped = bodies.filter((b: any) => b?.status === LEASE_SKIPPED)
    expect(skipped).toHaveLength(1)

    // 15. the overlapping call is a clean skip, not an error
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
  })

  it('releases the lease so the next scheduled tick can run', async () => {
    const GET = await loadGet(path)
    await GET(request(`Bearer ${SECRET}`))
    expect(leaseStore.size).toBe(0)

    bodyEntries = []
    await GET(request(`Bearer ${SECRET}`))
    expect(bodyEntries.length).toBeGreaterThan(0)
  })

  it('uses its own lease name so workers do not block each other', async () => {
    leaseStore.set(name === 'qr-reverse-worker' ? 'some-other-worker' : 'qr-reverse-worker', {
      owner: 'x',
      until: Date.now() + 60_000,
    })
    const GET = await loadGet(path)
    const res = await GET(request(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    expect(bodyEntries.length).toBeGreaterThan(0)
  })
})
