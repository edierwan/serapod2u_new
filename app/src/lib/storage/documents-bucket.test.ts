import { describe, expect, it, vi } from 'vitest'
import {
  createDocumentsSignedUrl,
  documentsObjectPath,
  qualityIssueEvidencePath,
  userSignaturePath,
} from './documents-bucket'

describe('documents bucket references', () => {
  it('keeps bare paths stable and parses historical public and signed URLs', () => {
    expect(documentsObjectPath('quality_issues/a/photo.png')).toBe('quality_issues/a/photo.png')
    expect(documentsObjectPath('documents/quality_issues/a/photo.png')).toBe('quality_issues/a/photo.png')
    expect(documentsObjectPath('https://storage.test/storage/v1/object/public/documents/signatures/u1/a.png'))
      .toBe('signatures/u1/a.png')
    expect(documentsObjectPath('https://storage.test/storage/v1/object/sign/documents/signatures/u1/a.png?token=x'))
      .toBe('signatures/u1/a.png')
  })

  it('rejects other buckets, arbitrary URLs and traversal', () => {
    expect(documentsObjectPath('https://storage.test/storage/v1/object/public/avatars/u1/a.png')).toBeNull()
    expect(documentsObjectPath('https://example.test/private.pdf')).toBeNull()
    expect(documentsObjectPath('../secret.pdf')).toBeNull()
    expect(documentsObjectPath('quality_issues\\secret.pdf')).toBeNull()
  })

  it('owner-scopes signatures and type-scopes quality evidence', () => {
    expect(userSignaturePath('signatures/u1/a.png', 'u1')).toBe('signatures/u1/a.png')
    expect(userSignaturePath('signatures/u2/a.png', 'u1')).toBeNull()
    expect(userSignaturePath('quality_issues/u1/a.png', 'u1')).toBeNull()
    expect(qualityIssueEvidencePath('quality_issues/u1/a.png')).toBe('quality_issues/u1/a.png')
    expect(qualityIssueEvidencePath('signatures/u1/a.png')).toBeNull()
  })

  it('creates a short-lived URL with the storage gateway API key', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-test-key')
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.test/object/sign/documents/a.pdf?token=short' },
      error: null,
    })
    const admin = { storage: { from: vi.fn(() => ({ createSignedUrl })) } } as any

    const result = await createDocumentsSignedUrl(admin, 'a.pdf')

    expect(createSignedUrl).toHaveBeenCalledWith('a.pdf', 300)
    expect(result).toContain('token=short')
    expect(result).toContain('apikey=anon-test-key')
    vi.unstubAllEnvs()
  })
})
