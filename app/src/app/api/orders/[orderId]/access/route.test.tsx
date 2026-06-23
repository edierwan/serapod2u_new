import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticated: true,
  requesterOrgId: 'mfg-1',
  requesterOrgType: 'MFG',
  requesterRoleLevel: 30,
  order: {
    id: 'order-1',
    company_id: 'company-1',
    buyer_org_id: 'hq-1',
    seller_org_id: 'mfg-1',
    warehouse_org_id: null,
  } as any,
}))

function query(result: () => any) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    single: async () => result(),
    maybeSingle: async () => result(),
  }
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => mocks.authenticated
        ? { data: { user: { id: 'requester-1' } }, error: null }
        : { data: { user: null }, error: new Error('not authenticated') },
    },
    from: (table: string) => query(() => table === 'users'
      ? {
          data: {
            organization_id: mocks.requesterOrgId,
            organizations: { org_type_code: mocks.requesterOrgType },
            roles: { role_level: mocks.requesterRoleLevel },
          },
          error: null,
        }
      : { data: mocks.order, error: null }),
  }),
}))

import { GET } from './route'

const request = () => new Request('http://localhost/api/orders/order-1/access') as any
const context = () => ({ params: Promise.resolve({ orderId: 'order-1' }) })

describe('order detail access', () => {
  beforeEach(() => {
    mocks.authenticated = true
    mocks.requesterOrgId = 'mfg-1'
    mocks.requesterOrgType = 'MFG'
    mocks.requesterRoleLevel = 30
    mocks.order = {
      id: 'order-1',
      company_id: 'company-1',
      buyer_org_id: 'hq-1',
      seller_org_id: 'mfg-1',
      warehouse_org_id: null,
    }
  })

  it('allows a Manufacturer user to view its own organization order', async () => {
    const response = await GET(request(), context())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, order_id: 'order-1' })
  })

  it('returns 403 when a Manufacturer requests another manufacturer order', async () => {
    mocks.order.seller_org_id = 'mfg-2'
    const response = await GET(request(), context())
    expect(response.status).toBe(403)
  })

  it('returns 403 when RLS does not expose the requested order', async () => {
    mocks.order = null
    const response = await GET(request(), context())
    expect(response.status).toBe(403)
  })

  it('retains authorized order visibility for HQ Admin level 10', async () => {
    mocks.requesterOrgType = 'HQ'
    mocks.requesterRoleLevel = 10
    mocks.order.seller_org_id = 'mfg-2'
    const response = await GET(request(), context())
    expect(response.status).toBe(200)
  })

  it('returns 401 for an unauthenticated direct API request', async () => {
    mocks.authenticated = false
    const response = await GET(request(), context())
    expect(response.status).toBe(401)
  })
})
