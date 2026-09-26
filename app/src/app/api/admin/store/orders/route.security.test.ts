import { beforeEach, describe, expect, it, vi } from 'vitest'

// Phase 0B: PUT /api/admin/store/orders must re-apply the organization scope
// to the update itself, so an order id alone cannot cross tenants.

const authGetUser = vi.fn()
const profileSingle = vi.fn()
const updateResult = vi.fn()
const updateCalls: Array<{ payload: any; filters: string[] }> = []

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'users') {
        return { select: () => ({ eq: () => ({ single: profileSingle }) }) }
      }
      const call = { payload: null as any, filters: [] as string[] }
      const chain: any = {
        update: (payload: any) => { call.payload = payload; updateCalls.push(call); return chain },
        eq: (column: string, value: string) => { call.filters.push(`eq:${column}=${value}`); return chain },
        or: (filter: string) => { call.filters.push(`or:${filter}`); return chain },
        select: () => chain,
        maybeSingle: updateResult,
      }
      return chain
    },
  })),
}))

const ORDER_ID = '3f1c2b7e-8a44-4c55-9d7e-0a1b2c3d4e5f'

const put = (body: Record<string, unknown>) => new Request('http://localhost/api/admin/store/orders', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}) as any

const hqAdmin = (orgId = 'hq-org-a', roleLevel = 10, orgType = 'HQ') => {
  authGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
  profileSingle.mockResolvedValue({
    data: { id: 'admin-1', organization_id: orgId, role_code: 'HQ', organizations: { id: orgId, org_type_code: orgType }, roles: { role_level: roleLevel } },
  })
}

describe('PUT /api/admin/store/orders tenant boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateCalls.length = 0
  })

  it('denies unauthenticated callers', async () => {
    authGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } })
    const { PUT } = await import('./route')
    const response = await PUT(put({ id: ORDER_ID, status: 'shipped' }))
    expect(response.status).toBe(401)
    expect(updateCalls).toHaveLength(0)
  })

  it('denies authenticated users who are not HQ store admins', async () => {
    hqAdmin('shop-org', 50, 'SHOP')
    const { PUT } = await import('./route')
    const response = await PUT(put({ id: ORDER_ID, status: 'shipped' }))
    expect(response.status).toBe(401)
    expect(updateCalls).toHaveLength(0)
  })

  it('scopes the update to the admin organization (or legacy unscoped orders)', async () => {
    hqAdmin('hq-org-a')
    updateResult.mockResolvedValue({ data: { id: ORDER_ID, status: 'shipped' }, error: null })
    const { PUT } = await import('./route')
    const response = await PUT(put({ id: ORDER_ID, status: 'shipped' }))
    expect(response.status).toBe(200)
    expect(updateCalls[0].filters).toEqual([
      `eq:id=${ORDER_ID}`,
      'or:organization_id.eq.hq-org-a,organization_id.is.null',
    ])
  })

  it('returns the same 404 for another organization\'s order and an unknown order', async () => {
    hqAdmin('hq-org-a')
    updateResult.mockResolvedValue({ data: null, error: null })
    const { PUT } = await import('./route')
    const crossOrg = await PUT(put({ id: ORDER_ID, status: 'refunded' }))
    const unknown = await PUT(put({ id: '00000000-0000-4000-8000-000000000000', status: 'refunded' }))
    expect(crossOrg.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect(await crossOrg.json()).toEqual(await unknown.json())
  })

  it('rejects malformed order ids without touching the database', async () => {
    hqAdmin('hq-org-a')
    const { PUT } = await import('./route')
    const response = await PUT(put({ id: 'x,organization_id.neq.null', status: 'shipped' }))
    expect(response.status).toBe(404)
    expect(updateCalls).toHaveLength(0)
  })
})
