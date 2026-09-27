import { describe, expect, it } from 'vitest'
import { shadowComparisonFor } from './comparison'

describe('shadow authorization comparison', () => {
  it('classifies matching and divergent decisions', () => {
    expect(shadowComparisonFor('ALLOW', 'ALLOW', 'ALLOWED_BY_ASSIGNMENT')).toBe('MATCH_ALLOW')
    expect(shadowComparisonFor('DENY', 'DENY', 'MISSING_PERMISSION')).toBe('MATCH_DENY')
    expect(shadowComparisonFor('ALLOW', 'DENY', 'MISSING_PERMISSION')).toBe('LEGACY_ALLOW_NEW_DENY')
    expect(shadowComparisonFor('DENY', 'ALLOW', 'ALLOWED_BY_ASSIGNMENT')).toBe('LEGACY_DENY_NEW_ALLOW')
  })

  it('preserves actionable new-policy diagnostic categories in SHADOW mode', () => {
    expect(shadowComparisonFor('ALLOW', 'DENY', 'SCOPE_MISMATCH')).toBe('SCOPE_MISMATCH')
    expect(shadowComparisonFor('ALLOW', 'DENY', 'MISSING_ASSIGNMENT')).toBe('MISSING_ASSIGNMENT')
    expect(shadowComparisonFor('ALLOW', 'DENY', 'MISSING_CONTEXT')).toBe('MISSING_CONTEXT')
    expect(shadowComparisonFor('ALLOW', 'DENY', 'POLICY_ERROR')).toBe('POLICY_ERROR')
  })
})
