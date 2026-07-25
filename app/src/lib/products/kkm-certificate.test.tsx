import { describe, expect, it } from 'vitest'
import {
  KKM_CERTIFICATE_MAX_FILE_SIZE,
  kkmCertificateAccessUrl,
  normalizeKkmCertificateStoragePath,
  validateKkmCertificate,
} from './kkm-certificate'

function file(name: string, type: string, size = 10) {
  return { name, type, size } as File
}

describe('validateKkmCertificate', () => {
  it.each([
    ['approval.pdf', 'application/pdf'],
    ['approval.jpg', 'image/jpeg'],
    ['approval.jpeg', 'image/jpeg'],
    ['approval.png', 'image/png'],
  ])('accepts %s', (name, type) => {
    expect(validateKkmCertificate(file(name, type))).toBeNull()
  })

  it('rejects unsupported or disguised files', () => {
    expect(validateKkmCertificate(file('approval.exe', 'application/octet-stream'))).toMatch(/PDF/)
    expect(validateKkmCertificate(file('approval.pdf', 'image/png'))).toMatch(/PDF/)
  })

  it('rejects files over 10 MB', () => {
    expect(validateKkmCertificate(file('approval.pdf', 'application/pdf', KKM_CERTIFICATE_MAX_FILE_SIZE + 1))).toMatch(/10 MB/)
  })
})

describe('KKM certificate private object references', () => {
  const variantId = '11111111-1111-4111-8111-111111111111'

  it.each([
    [`${variantId}/approval.pdf`, `${variantId}/approval.pdf`],
    [`kkm-certificates/${variantId}/approval.jpg`, `${variantId}/approval.jpg`],
    [`https://supabase.internal/storage/v1/object/sign/kkm-certificates/${variantId}/approval%20file.pdf?token=expired`, `${variantId}/approval file.pdf`],
    [`https://supabase.internal/storage/v1/object/authenticated/kkm-certificates/${variantId}/approval.png`, `${variantId}/approval.png`],
  ])('normalizes current and legacy value %s', (stored, expected) => {
    expect(normalizeKkmCertificateStoragePath(stored, variantId)).toBe(expected)
  })

  it.each([
    'other-variant/approval.pdf',
    `other-bucket/${variantId}/approval.pdf`,
    `https://supabase.internal/storage/v1/object/sign/other-bucket/${variantId}/approval.pdf?token=x`,
    `https://example.test/${variantId}/approval.pdf`,
    `${variantId}/../other-variant/approval.pdf`,
    `${variantId}\\approval.pdf`,
  ])('rejects an unrelated or unsafe reference %s', (stored) => {
    expect(normalizeKkmCertificateStoragePath(stored, variantId)).toBeNull()
  })

  it('builds a same-origin access URL without a Supabase host, token, or API key', () => {
    expect(kkmCertificateAccessUrl(variantId)).toBe(`/api/products/variants/${variantId}/kkm-certificate`)
    expect(kkmCertificateAccessUrl(variantId, true)).toBe(`/api/products/variants/${variantId}/kkm-certificate?download=1`)
    expect(kkmCertificateAccessUrl(variantId, true)).not.toMatch(/supabase|token|apikey|service/i)
  })
})
