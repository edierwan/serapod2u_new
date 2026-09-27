import { describe, expect, it } from 'vitest'
import { legacyRoleLevel, normalizeLegacyRoleAlias } from './legacy-aliases'

describe('legacy authorization compatibility aliases', () => {
  it.each(['SA', 'SUPER', 'SUPERADMIN', 'SUPER_ADMIN', 'super admin'])(
    'normalizes %s without inventing a business role', alias => expect(normalizeLegacyRoleAlias(alias)).toBe('SUPER_ADMIN'))
  it.each(['HQ', 'HQ_ADMIN', 'ADMIN', 'ADMIN_HQ'])(
    'normalizes %s to the existing HQ compatibility role', alias => expect(normalizeLegacyRoleAlias(alias)).toBe('HQ_ADMIN'))
  it('preserves an explicit role level over an alias', () => expect(legacyRoleLevel(30, 'SA')).toBe(30))
  it('does not broaden an unknown legacy code', () => {
    expect(normalizeLegacyRoleAlias('custom_read_only')).toBe('CUSTOM_READ_ONLY')
    expect(legacyRoleLevel(null, 'custom_read_only')).toBeNull()
  })
})
