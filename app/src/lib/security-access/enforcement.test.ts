import { describe, expect, it } from 'vitest'
import { auditClassFor, auditWriteFailureIsFatal, authoritativeOutcome, consultsLegacy, isNewAuthoritative } from './enforcement'
import { shadowComparisonFor } from './comparison'
import { organizationContextForWarehouse } from './resource-context'
import type { MigrationMode } from './types'

const base = { actorActive: true, newReasonCode: 'MISSING_PERMISSION' as const }

describe('migration-mode enforcement contract', () => {
  it('legacy controls in LEGACY_ENFORCED and SHADOW', () => {
    for (const mode of ['LEGACY_ENFORCED', 'SHADOW'] as MigrationMode[]) {
      expect(authoritativeOutcome({ ...base, mode, legacyDecision: 'ALLOW', newDecision: 'DENY' })).toEqual({ decision: 'ALLOW', reasonCode: 'LEGACY_ALLOWED' })
      expect(authoritativeOutcome({ ...base, mode, legacyDecision: 'DENY', newDecision: 'ALLOW' })).toEqual({ decision: 'DENY', reasonCode: 'LEGACY_DENIED' })
    }
  })

  it('new engine controls in NEW_ENFORCED and LEGACY_RETIRED with no legacy fallback', () => {
    for (const mode of ['NEW_ENFORCED', 'LEGACY_RETIRED'] as MigrationMode[]) {
      expect(authoritativeOutcome({ ...base, mode, legacyDecision: 'ALLOW', newDecision: 'DENY' })).toEqual({ decision: 'DENY', reasonCode: 'MISSING_PERMISSION' })
      expect(authoritativeOutcome({ ...base, mode, legacyDecision: null, newDecision: 'DENY' }).decision).toBe('DENY')
    }
  })

  it('a missing legacy decision never allows in a legacy-controlled mode', () => {
    expect(authoritativeOutcome({ ...base, mode: 'SHADOW', legacyDecision: null, newDecision: 'ALLOW' }).decision).toBe('DENY')
  })

  it('inactive accounts are denied in every mode', () => {
    for (const mode of ['LEGACY_ENFORCED', 'SHADOW', 'NEW_ENFORCED', 'LEGACY_RETIRED'] as MigrationMode[]) {
      expect(authoritativeOutcome({ mode, actorActive: false, legacyDecision: 'ALLOW', newDecision: 'ALLOW', newReasonCode: 'ALLOWED_BY_ASSIGNMENT' }))
        .toEqual({ decision: 'DENY', reasonCode: 'ACCOUNT_INACTIVE' })
    }
  })

  it('legacy is not consulted once retired and audit failure is fatal only when new is authoritative', () => {
    expect(consultsLegacy('LEGACY_RETIRED')).toBe(false)
    expect(consultsLegacy('NEW_ENFORCED')).toBe(true)
    expect(isNewAuthoritative('SHADOW')).toBe(false)
    expect(auditWriteFailureIsFatal('NEW_ENFORCED')).toBe(true)
    expect(auditWriteFailureIsFatal('SHADOW')).toBe(false)
  })
})

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

describe('comparison without a legacy decision', () => {
  it('records the new decision only', () => {
    expect(shadowComparisonFor(null, 'ALLOW', 'ALLOWED_BY_ASSIGNMENT')).toBe('MATCH_ALLOW')
    expect(shadowComparisonFor(null, 'DENY', 'MISSING_PERMISSION')).toBe('MATCH_DENY')
    expect(shadowComparisonFor(null, 'DENY', 'SCOPE_MISMATCH')).toBe('SCOPE_MISMATCH')
  })
})

describe('warehouse resource organization context', () => {
  const chain = ['wh-a1', 'hq-a']
  it('uses the actor organization only when it owns the warehouse', () => {
    expect(organizationContextForWarehouse('hq-a', chain, 'wh-a1')).toBe('hq-a')
    expect(organizationContextForWarehouse('wh-a1', chain, 'wh-a1')).toBe('wh-a1')
  })
  it('attributes the resource to its owning root for any other organization', () => {
    expect(organizationContextForWarehouse('hq-b', chain, 'wh-a1')).toBe('hq-a')
    expect(organizationContextForWarehouse('dist-a', chain, 'wh-a1')).toBe('hq-a')
    expect(organizationContextForWarehouse('wh-a2', chain, 'wh-a1')).toBe('hq-a')
    expect(organizationContextForWarehouse(null, chain, 'wh-a1')).toBe('hq-a')
  })
  it('falls back to the warehouse itself when ancestry is unknown', () => {
    expect(organizationContextForWarehouse('hq-a', [], 'wh-x')).toBe('wh-x')
  })
})
