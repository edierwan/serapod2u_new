import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/security-access/operation', async () => (await import('@/test-support/sa-legacy-mode')).operationModule)
vi.mock('@/lib/security-access/resource-context', async () => (await import('@/test-support/sa-legacy-mode')).resourceContextModule)

const authGetUser = vi.fn()
const profileSingle = vi.fn()
const maybeSingle = vi.fn()
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
        maybeSingle,
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

describe('PUT /api/admin/store/orders — shipping an order', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateCalls.length = 0
    authGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
    profileSingle.mockResolvedValue({
      data: { id: 'admin-1', organization_id: 'hq', role_code: 'HQ', organizations: { id: 'hq', org_type_code: 'HQ' }, roles: { role_level: 10 } },
    })
  })

  it('refuses to ship an Outdoor order without a courier and tracking number', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: ORDER_ID, sales_channel: 'outdoor', shipping_tracking_no: null, shipping_courier_name: null } })
    const { PUT } = await import('./route')
    const response = await PUT(put({ id: ORDER_ID, status: 'shipped', trackingNo: 'JT123' }))
    expect(response.status).toBe(400)
    expect(updateCalls).toHaveLength(0)
  })

  it('saves the courier and tracking number when shipping an Outdoor order', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: { id: ORDER_ID, sales_channel: 'outdoor', shipping_tracking_no: null, shipping_courier_name: null } })
      .mockResolvedValueOnce({ data: { id: ORDER_ID, status: 'shipped' }, error: null })
    const { PUT } = await import('./route')
    const response = await PUT(put({ id: ORDER_ID, status: 'shipped', trackingNo: ' JT123 ', courierName: 'J&T Express' }))
    expect(response.status).toBe(200)
    expect(updateCalls[0].payload).toEqual({ status: 'shipped', shipping_tracking_no: 'JT123', shipping_courier_name: 'J&T Express' })
  })

  it('keeps classic store orders shippable without tracking', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: { id: ORDER_ID, sales_channel: 'store', shipping_tracking_no: null, shipping_courier_name: null } })
      .mockResolvedValueOnce({ data: { id: ORDER_ID, status: 'shipped' }, error: null })
    const { PUT } = await import('./route')
    const response = await PUT(put({ id: ORDER_ID, status: 'shipped' }))
    expect(response.status).toBe(200)
    expect(updateCalls[0].payload).toEqual({ status: 'shipped' })
  })

  it('ships an Outdoor order with our own delivery team, without a tracking number', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: { id: ORDER_ID, status: 'processing', sales_channel: 'outdoor', shipping_tracking_no: null, shipping_courier_name: null } })
      .mockResolvedValueOnce({ data: { id: ORDER_ID, status: 'shipped' }, error: null })
    const { PUT } = await import('./route')
    const response = await PUT(put({ id: ORDER_ID, status: 'shipped', deliveryMethod: 'own', trackingNo: 'ignored' }))
    expect(response.status).toBe(200)
    expect(updateCalls[0].payload).toEqual({
      status: 'shipped',
      shipping_courier_name: 'Serapod delivery team',
      shipping_tracking_no: null,
    })
  })

  it('leaves shipping details alone for other status changes', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: { id: ORDER_ID, status: 'shipped', sales_channel: 'outdoor' } })
      .mockResolvedValueOnce({ data: { id: ORDER_ID, status: 'delivered' }, error: null })
    const { PUT } = await import('./route')
    const response = await PUT(put({ id: ORDER_ID, status: 'delivered', trackingNo: 'ignored', deliveryMethod: 'own' }))
    expect(response.status).toBe(200)
    expect(updateCalls[0].payload).toEqual({ status: 'delivered' })
  })
})
