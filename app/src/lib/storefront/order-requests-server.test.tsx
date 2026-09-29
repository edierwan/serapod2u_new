import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/email/transactional-html-email', () => ({ sendTransactionalHtmlEmail: async () => ({ success: true }) }))
vi.mock('@/server/auth/passwordResetService', () => ({ resolveOrgForEmail: async () => 'hq' }))

import { listOrderRequests } from './order-requests-server'

const signed = 'https://supabase-stg.example/storage/v1/object/sign/storefront-requests/o1/RQ-1/1.jpg?token=abc'

function fakeAdmin() {
  const rows = [{
    id: 'r1',
    request_no: 'RQ-1',
    order_id: 'o1',
    sales_channel: 'outdoor',
    customer_email: 'aina@example.com',
    request_type: 'damaged',
    status: 'new',
    message: 'Arrived broken',
    photo_paths: ['o1/RQ-1/1.jpg'],
    storefront_orders: { order_ref: 'ORD-1', status: 'delivered' },
  }]
  const query: any = {
    select: () => query,
    order: () => query,
    limit: () => query,
    eq: () => query,
    in: () => query,
    then: (ok: any) => Promise.resolve({ data: rows, error: null }).then(ok),
  }
  return {
    from: () => query,
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [{ path: 'o1/RQ-1/1.jpg', signedUrl: signed }], error: null }) }) },
  }
}

describe('listOrderRequests photos', () => {
  const saved = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  beforeEach(() => { process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key' })
  afterEach(() => { process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved })

  it('adds the public API key the storage gateway needs to open a signed photo', async () => {
    const result = await listOrderRequests(fakeAdmin(), { salesChannel: 'outdoor' })
    expect(result.ok).toBe(true)
    const photo = (result as any).requests[0].photos[0] as string
    expect(photo.startsWith(signed.split('?')[0])).toBe(true)
    const url = new URL(photo)
    expect(url.searchParams.get('token')).toBe('abc')
    expect(url.searchParams.get('apikey')).toBe('anon-key')
  })
})
