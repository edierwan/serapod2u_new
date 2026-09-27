import { beforeEach, describe, expect, it, vi } from 'vitest'

// S&A in legacy mode: this suite tests the route's own rules.
vi.mock('@/lib/security-access/operation', async () => (await import('@/test-support/sa-legacy-mode')).operationModule)
vi.mock('@/lib/security-access/resource-context', async () => (await import('@/test-support/sa-legacy-mode')).resourceContextModule)

// ---------------------------------------------------------------------------
// Phase 0B: warehouse shipment endpoints must authenticate the caller, ignore
// body-supplied user ids and enforce the Phase 0A warehouse/company scope.
// ---------------------------------------------------------------------------

const authGetUser = vi.fn()
const sessionScope = vi.fn()
const actorProfile = vi.fn()
const masterScope = vi.fn()
const sessionClientFrom = vi.fn()
const sessionClientRpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: authGetUser },
    from: sessionClientFrom,
    rpc: sessionClientRpc,
  })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: table === 'qr_validation_reports' ? sessionScope : actorProfile,
          maybeSingle: masterScope,
        }),
      }),
    }),
  })),
}))

const post = (path: string, body: Record<string, unknown>) => new Request(
  `http://localhost/api/warehouse/${path}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
) as any

const signedIn = (id = 'real-user') => authGetUser.mockResolvedValue({ data: { user: { id } }, error: null })
const anonymous = () => authGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'missing' } })
const actor = (organization_id: string, org_type_code: string, role_level = 30, is_active = true) =>
  actorProfile.mockResolvedValue({
    data: { id: 'real-user', organization_id, is_active, roles: { role_level }, organizations: { org_type_code } },
    error: null,
  })

// A session-client stub that records writes and never succeeds past the first read,
// so tests observe authorization without executing shipment mutations.
const recordingSessionClient = () => {
  const inserts: any[] = []
  sessionClientFrom.mockImplementation((table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: { message: 'not found' } }),
      insert: (payload: any) => {
        inserts.push({ table, payload })
        return { select: () => ({ single: async () => ({ data: null, error: { message: 'stop' } }) }) }
      },
      then: undefined,
    }
    return chain
  })
  return inserts
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionScope.mockResolvedValue({ data: { id: 'session-1', warehouse_org_id: 'warehouse-1', company_id: 'hq-1' }, error: null })
  masterScope.mockResolvedValue({ data: { warehouse_org_id: 'warehouse-1', company_id: 'hq-1' }, error: null })
  sessionClientRpc.mockResolvedValue({ data: 'hq-1', error: null })
})

describe.each([
  ['cancel-shipment', { session_id: 'session-1', user_id: 'spoofed-admin' }],
  ['unlink-shipment-code', { session_id: 'session-1', code: 'X', code_type: 'unique', user_id: 'spoofed-admin' }],
  ['unlink-product-from-sessions', { session_ids: ['8f5b8d2e-6d1c-4a8b-9b8e-1f2a3b4c5d6e'], product_name: 'P', user_id: 'spoofed-admin' }],
  ['scan-for-shipment', { shipment_session_id: 'session-1', code: 'X', user_id: 'spoofed-admin' }],
  ['scan-batch-for-shipment', { shipment_session_id: 'session-1', codes: ['X'], user_id: 'spoofed-admin' }],
  ['complete-shipment', { shipment_session_id: 'session-1', user_id: 'spoofed-admin' }],
])('POST /api/warehouse/%s security boundary', (route, body) => {
  const load = async () => (await import(`./${route}/route`)).POST

  it('rejects anonymous callers even when a user_id is supplied', async () => {
    anonymous()
    recordingSessionClient()
    const response = await (await load())(post(route, body))
    expect(response.status).toBe(401)
    expect(sessionClientFrom).not.toHaveBeenCalled()
  })

  it('rejects an actor from another warehouse (cross-warehouse)', async () => {
    signedIn()
    actor('warehouse-2', 'WH')
    recordingSessionClient()
    const response = await (await load())(post(route, body))
    expect(response.status).toBe(403)
    expect(sessionClientFrom).not.toHaveBeenCalled()
  })

  it('rejects an HQ actor of another company (cross-organization)', async () => {
    signedIn()
    actor('hq-2', 'HQ', 10)
    recordingSessionClient()
    const response = await (await load())(post(route, body))
    expect(response.status).toBe(403)
  })

  it('rejects an ordinary shop/consumer account', async () => {
    signedIn()
    actor('shop-1', 'SHOP', 50)
    recordingSessionClient()
    const response = await (await load())(post(route, body))
    expect(response.status).toBe(403)
  })

  it('rejects an inactive warehouse user', async () => {
    signedIn()
    actor('warehouse-1', 'WH', 30, false)
    recordingSessionClient()
    const response = await (await load())(post(route, body))
    expect(response.status).toBe(403)
  })

  it('lets an in-scope warehouse actor through the authorization boundary', async () => {
    signedIn()
    actor('warehouse-1', 'WH')
    recordingSessionClient()
    const response = await (await load())(post(route, body))
    expect([401, 403]).not.toContain(response.status)
    expect(sessionClientFrom).toHaveBeenCalled()
  })

  it('lets an HQ actor of the same company through the authorization boundary', async () => {
    signedIn()
    actor('hq-1', 'HQ', 10)
    recordingSessionClient()
    const response = await (await load())(post(route, body))
    expect([401, 403]).not.toContain(response.status)
  })
})

describe('POST /api/warehouse/start-shipment', () => {
  const load = async () => (await import('./start-shipment/route')).POST
  const body = { warehouse_org_id: 'warehouse-1', distributor_org_id: 'dist-1', user_id: 'spoofed-admin' }

  it('rejects an actor from another warehouse before creating a session', async () => {
    signedIn()
    actor('warehouse-2', 'WH')
    const inserts = recordingSessionClient()
    const response = await (await load())(post('start-shipment', body))
    expect(response.status).toBe(403)
    expect(inserts).toHaveLength(0)
  })

  it('attributes the new session to the verified user, never the body user_id', async () => {
    signedIn('real-user')
    actor('warehouse-1', 'WH')
    const inserts = recordingSessionClient()
    await (await load())(post('start-shipment', body))
    const sessionInsert = inserts.find((entry) => entry.table === 'qr_validation_reports')
    expect(sessionInsert?.payload.created_by).toBe('real-user')
  })
})

describe('shipment route contract', () => {
  it('no warehouse shipment route reads user_id from the request body for attribution', async () => {
    const { readFileSync } = await import('node:fs')
    for (const route of [
      'start-shipment', 'scan-for-shipment', 'scan-batch-for-shipment', 'complete-shipment',
      'cancel-shipment', 'unlink-shipment-code', 'unlink-product-from-sessions', 'receive-master',
    ]) {
      const source = readFileSync(new URL(`./${route}/route.ts`, import.meta.url), 'utf8')
      expect(source, route).not.toMatch(/user_id:\s*(overrideUserId|userId)/)
      expect(source, route).not.toMatch(/\|\|\s*user\.id/)
      expect(source, route).not.toMatch(/scanned_by:\s*user_id/)
      expect(source, route).toContain('supabase.auth.getUser()')
    }
  })
})
