import { describe, expect, it } from 'vitest'
import { orderDocumentPath, safeOrderDocumentFileName } from './order-documents-bucket'

describe('orderDocumentPath', () => {
  it('accepts a bare path only under the requested order', () => {
    expect(orderDocumentPath('order-1/proof.pdf', 'order-1')).toBe('order-1/proof.pdf')
    expect(orderDocumentPath('order-2/proof.pdf', 'order-1')).toBeNull()
  })

  it('normalizes a legacy public URL', () => {
    expect(orderDocumentPath(
      'https://example.supabase.co/storage/v1/object/public/order-documents/order-1/proof.pdf',
      'order-1'
    )).toBe('order-1/proof.pdf')
  })

  it('rejects traversal and other buckets', () => {
    expect(orderDocumentPath('order-1/../secret.pdf', 'order-1')).toBeNull()
    expect(orderDocumentPath(
      'https://example.supabase.co/storage/v1/object/public/documents/order-1/proof.pdf',
      'order-1'
    )).toBeNull()
  })
})

describe('safeOrderDocumentFileName', () => {
  it('removes header-breaking and path characters', () => {
    expect(safeOrderDocumentFileName('../bad\r\nname.pdf')).toBe('_bad__name.pdf')
  })
})
