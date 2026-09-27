import { describe, expect, it } from 'vitest'
import { auditClassFor } from './enforcement'
import type { MigrationMode } from './types'

describe('audit classification', () => {
  const cls = (mode: MigrationMode, sensitivity: 'ordinary' | 'security_sensitive', comparison: any, reasonCode: any = 'LEGACY_ALLOWED') =>
    auditClassFor({ mode, sensitivity, comparison, reasonCode })
  it('only non-authoritative, error-free, ordinary decisions are ORDINARY_SHADOW', () => {
    expect(cls('SHADOW', 'ordinary', 'MATCH_ALLOW')).toBe('ORDINARY_SHADOW')
    expect(cls('LEGACY_ENFORCED', 'ordinary', 'LEGACY_ALLOW_NEW_DENY')).toBe('ORDINARY_SHADOW')
    expect(cls('SHADOW', 'ordinary', 'POLICY_ERROR')).toBe('POLICY_ERROR')
    expect(cls('NEW_ENFORCED', 'ordinary', 'MATCH_DENY', 'MISSING_PERMISSION')).toBe('ENFORCED_DECISION')
    expect(cls('LEGACY_RETIRED', 'ordinary', 'MATCH_ALLOW', 'ALLOWED_BY_ASSIGNMENT')).toBe('ENFORCED_DECISION')
    expect(cls('SHADOW', 'security_sensitive', 'MATCH_ALLOW')).toBe('SECURITY_SENSITIVE')
    expect(cls('NEW_ENFORCED', 'ordinary', 'MATCH_ALLOW', 'POLICY_ERROR')).toBe('POLICY_ERROR')
  })
})
