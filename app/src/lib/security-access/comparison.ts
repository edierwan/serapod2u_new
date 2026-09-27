import type { AuthorizationDecisionValue, AuthorizationReasonCode, ShadowComparison } from './types'

export function shadowComparisonFor(
  legacyDecision: AuthorizationDecisionValue,
  newDecision: AuthorizationDecisionValue,
  newReasonCode: AuthorizationReasonCode,
): ShadowComparison {
  if (newReasonCode === 'SCOPE_MISMATCH') return 'SCOPE_MISMATCH'
  if (newReasonCode === 'MISSING_ASSIGNMENT') return 'MISSING_ASSIGNMENT'
  if (newReasonCode === 'MISSING_CONTEXT') return 'MISSING_CONTEXT'
  if (newReasonCode === 'POLICY_ERROR') return 'POLICY_ERROR'
  if (legacyDecision === 'ALLOW' && newDecision === 'ALLOW') return 'MATCH_ALLOW'
  if (legacyDecision === 'DENY' && newDecision === 'DENY') return 'MATCH_DENY'
  if (legacyDecision === 'ALLOW') return 'LEGACY_ALLOW_NEW_DENY'
  return 'LEGACY_DENY_NEW_ALLOW'
}
