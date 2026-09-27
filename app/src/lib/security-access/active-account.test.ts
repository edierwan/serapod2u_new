import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isActiveAccountRecord } from './active-account'

const root = process.cwd()
const routes = [
  'src/app/api/security-access/overview/route.ts',
  'src/app/api/security-access/simulate/route.ts',
  'src/app/api/security-access/roles/route.ts',
  'src/app/api/security-access/pilot/transfer-shadow/route.ts',
]

describe('Security & Access active-account gate', () => {
  it('allows only an explicit active record and fails closed', () => {
    expect(isActiveAccountRecord({ is_active: true })).toBe(true)
    expect(isActiveAccountRecord({ is_active: false })).toBe(false)
    expect(isActiveAccountRecord(null)).toBe(false)
    expect(isActiveAccountRecord({ is_active: true }, new Error('lookup failed'))).toBe(false)
  })

  it('is applied explicitly to every Security & Access API family', () => {
    for (const route of routes) {
      const source = readFileSync(resolve(root, route), 'utf8')
      expect(source).toContain("import { isActiveSecurityAccessAccount }")
      expect(source).toContain('await isActiveSecurityAccessAccount(user.id)')
    }
  })
})
