import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  document: { id: 'doc-1', order_id: 'order-1', company_id: 'company-1' } as any,
  file: { document_id: 'doc-1', file_name: 'proof.pdf', mime_type: 'application/pdf' } as any,
  download: vi.fn(),
}))

function query(result: () => any) {
  const chain: any = {}
  for (const method of ['select', 'eq', 'order', 'limit']) chain[method] = () => chain
  chain.maybeSingle = async () => ({ data: result(), error: null })
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
    from: () => query(() => mocks.document),
  }),
}))

vi.mock('@/lib/security-access/operation', () => ({ guardUserOperation: async () => null }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => query(() => mocks.file),
    storage: { from: () => ({ download: mocks.download }) },
  }),
}))

import { GET } from './route'

const context = { params: Promise.resolve({ orderId: 'order-1' }) }
const request = (path: string) => new NextRequest(
  `http://localhost/api/documents/order/order-1/file?path=${encodeURIComponent(path)}`
)

describe('authorized order document download', () => {
  beforeEach(() => {
    mocks.user = { id: 'user-1' }
    mocks.document = { id: 'doc-1', order_id: 'order-1', company_id: 'company-1' }
    mocks.file = { document_id: 'doc-1', file_name: 'proof.pdf', mime_type: 'application/pdf' }
    mocks.download.mockReset()
    mocks.download.mockResolvedValue({ data: new Blob(['pdf'], { type: 'application/pdf' }), error: null })
  })

  it('rejects a path belonging to another order before storage access', async () => {
    const response = await GET(request('order-2/proof.pdf'), context)
    expect(response.status).toBe(400)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('rejects anonymous callers before storage access', async () => {
    mocks.user = null
    const response = await GET(request('order-1/proof.pdf'), context)
    expect(response.status).toBe(401)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('does not disclose a file when its document is hidden by caller RLS', async () => {
    mocks.document = null
    const response = await GET(request('order-1/proof.pdf'), context)
    expect(response.status).toBe(404)
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it('downloads through the service client only after metadata and document authorization', async () => {
    const response = await GET(request('order-1/proof.pdf'), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.download).toHaveBeenCalledWith('order-1/proof.pdf')
  })
})
