import { describe, expect, it } from 'vitest'
import { KKM_CERTIFICATE_MAX_FILE_SIZE, validateKkmCertificate } from './kkm-certificate'

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
