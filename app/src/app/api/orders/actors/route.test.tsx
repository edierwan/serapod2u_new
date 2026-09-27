import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requesterOrgType: 'MFG',
  requesterRoleLevel: 40,
  orders: [] as any[],
  users: [] as any[],
  createSignedUrl: vi.fn(),
}))

function query(result: () => any) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    or: () => builder,
    single: async () => result(),
    then: (resolve: (value: any) => void) => resolve(result()),
  }
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'requester-1' } }, error: null }) },
    from: () => query(() => ({
      data: {
        organization_id: 'mfg-1',
        organizations: { org_type_code: mocks.requesterOrgType },
        roles: { role_level: mocks.requesterRoleLevel },
      },
      error: null,
    })),
    rpc: async () => ({ data: 'company-1', error: null }),
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => query(() => table === 'orders'
      ? { data: mocks.orders, error: null }
      : { data: mocks.users, error: null }),
    storage: {
      from: () => ({ createSignedUrl: mocks.createSignedUrl }),
    },
  }),
}))

import { POST } from './route'

const request = () => new Request('http://localhost/api/orders/actors', {
  method: 'POST',
  body: JSON.stringify({ orderIds: ['order-1'] }),
})

describe('order actor organization isolation', () => {
  beforeEach(() => {
    mocks.requesterOrgType = 'MFG'
    mocks.requesterRoleLevel = 40
    mocks.orders = [{ id: 'order-1', seller_org_id: 'mfg-1', created_by: 'actor-1', approved_by: null }]
    mocks.users = [{ id: 'actor-1', email: 'actor@example.com', full_name: 'Actor', signature_url: null, roles: { role_level: 40 } }]
    mocks.createSignedUrl.mockReset()
  })

  it('allows a Manufacturer user to resolve actors for its own order', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect((await response.json()).users).toHaveLength(1)
  })

  it('returns 403 when a Manufacturer requests another manufacturer order', async () => {
    mocks.orders = []
    const response = await POST(request())
    expect(response.status).toBe(403)
  })

  it('retains full company access for HQ Admin level 10', async () => {
    mocks.requesterOrgType = 'HQ'
    mocks.requesterRoleLevel = 10
    mocks.orders = [{ id: 'order-1', seller_org_id: 'other-mfg', created_by: 'actor-1', approved_by: null }]
    const response = await POST(request())
    expect(response.status).toBe(200)
  })

  it('returns a short-lived signature only after order authorization', async () => {
    mocks.users = [{
      id: 'actor-1',
      email: 'actor@example.com',
      full_name: 'Actor',
      signature_url: 'signatures/actor-1/signature.png',
      roles: { role_level: 40 },
    }]
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'http://storage.test/object/sign/documents/signatures/actor-1/signature.png?token=short' },
      error: null,
    })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('signatures/actor-1/signature.png', 300)
    expect(body.users[0].signature_url).toContain('token=short')
  })

  it('returns an authorized actor historical flat-path signature', async () => {
    mocks.users = [{
      id: 'actor-1',
      email: 'actor@example.com',
      full_name: 'Actor',
      signature_url: 'signatures/actor-1_1763485672062.png',
      roles: { role_level: 40 },
    }]
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'http://storage.test/object/sign/documents/signatures/actor-1_1763485672062.png?token=short' },
      error: null,
    })

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('signatures/actor-1_1763485672062.png', 300)
    expect(body.users[0].signature_url).toContain('token=short')
  })

  it('does not sign a user-editable reference outside the actor owner path', async () => {
    mocks.users = [{
      id: 'actor-1',
      email: 'actor@example.com',
      full_name: 'Actor',
      signature_url: 'signatures/another-user/signature.png',
      roles: { role_level: 40 },
    }]

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.createSignedUrl).not.toHaveBeenCalled()
    expect(body.users[0].signature_url).toBeNull()
  })
})
