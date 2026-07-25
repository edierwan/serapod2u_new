import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  getContext: vi.fn(),
  maybeSingle: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@/lib/server/stock-config-admin', () => ({
  getStockConfigAdminContext: mocks.getContext,
}))

function adminClient() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe('kkm-certificates')
        return { download: mocks.download }
      },
    },
  }
}

function request(download = false) {
  return new NextRequest(`http://localhost/api/products/variants/variant-1/kkm-certificate${download ? '?download=1' : ''}`)
}

const params = { params: Promise.resolve({ variantId: 'variant-1' }) }

describe('KKM certificate authenticated proxy', () => {
  beforeEach(() => {
    mocks.getContext.mockReset()
    mocks.maybeSingle.mockReset()
    mocks.download.mockReset()
    mocks.getContext.mockResolvedValue({ ok: true, admin: adminClient() })
    mocks.maybeSingle.mockResolvedValue({
      data: {
        product_variant_id: 'variant-1',
        storage_path: 'variant-1/approval.pdf',
        file_name: 'Approval certificate.pdf',
        mime_type: 'application/pdf',
      },
      error: null,
    })
    mocks.download.mockResolvedValue({
      data: new Blob(['private certificate'], { type: 'application/pdf' }),
      error: null,
    })
  })

  it('rejects unauthenticated and non-HQ users before reading metadata or storage', async () => {
    mocks.getContext.mockResolvedValue({ ok: false, status: 403, error: 'HQ administrator access required' })
    const response = await GET(request(), params)
    expect(response.status).toBe(403)
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
    expect(mocks.download).not.toHaveBeenCalled()
  })

  it.each([
    [false, 'inline', 'application/pdf', 'approval.pdf'],
    [false, 'inline', 'image/jpeg', 'approval.jpg'],
    [false, 'inline', 'image/png', 'approval.png'],
    [true, 'attachment', 'application/pdf', 'approval.pdf'],
  ])('serves an authorized private file (download=%s)', async (download, disposition, mimeType, fileName) => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        product_variant_id: 'variant-1',
        storage_path: `variant-1/${fileName}`,
        file_name: fileName,
        mime_type: mimeType,
      },
      error: null,
    })
    mocks.download.mockResolvedValue({ data: new Blob(['file'], { type: mimeType }), error: null })

    const response = await GET(request(download), params)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(mimeType)
    expect(response.headers.get('Content-Disposition')).toContain(disposition)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await response.text()).toBe('file')
  })

  it('normalizes a legacy self-hosted signed URL before fetching the private object', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        product_variant_id: 'variant-1',
        storage_path: 'https://supabase.internal/storage/v1/object/sign/kkm-certificates/variant-1/approval%20file.pdf?token=expired',
        file_name: 'approval file.pdf',
        mime_type: 'application/pdf',
      },
      error: null,
    })

    const response = await GET(request(), params)

    expect(response.status).toBe(200)
    expect(mocks.download).toHaveBeenCalledWith('variant-1/approval file.pdf')
  })

  it.each([
    'other-variant/approval.pdf',
    'https://supabase.internal/storage/v1/object/sign/other-bucket/variant-1/approval.pdf?token=x',
    'variant-1/../other-variant/approval.pdf',
  ])('rejects an arbitrary object reference %s', async (storagePath) => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        product_variant_id: 'variant-1',
        storage_path: storagePath,
        file_name: 'approval.pdf',
        mime_type: 'application/pdf',
      },
      error: null,
    })

    const response = await GET(request(), params)

    expect(response.status).toBe(400)
    expect(mocks.download).not.toHaveBeenCalled()
  })
})
