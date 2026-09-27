import type { AuthorizationDecisionValue, AuthorizationReasonCode, ShadowComparison } from './types'

export function shadowComparisonFor(
  legacyDecision: AuthorizationDecisionValue | null,
  newDecision: AuthorizationDecisionValue,
  newReasonCode: AuthorizationReasonCode,
): ShadowComparison {
  if (newReasonCode === 'SCOPE_MISMATCH') return 'SCOPE_MISMATCH'
  if (newReasonCode === 'MISSING_ASSIGNMENT') return 'MISSING_ASSIGNMENT'
  if (newReasonCode === 'MISSING_CONTEXT') return 'MISSING_CONTEXT'
  if (newReasonCode === 'POLICY_ERROR') return 'POLICY_ERROR'
  // Legacy not consulted (LEGACY_RETIRED) or unavailable while it is only
  // diagnostic: the row records the new decision alone; legacy_decision is NULL.
  const legacy = legacyDecision ?? newDecision
  if (legacy === 'ALLOW' && newDecision === 'ALLOW') return 'MATCH_ALLOW'
  if (legacy === 'DENY' && newDecision === 'DENY') return 'MATCH_DENY'
  if (legacy === 'ALLOW') return 'LEGACY_ALLOW_NEW_DENY'
  return 'LEGACY_DENY_NEW_ALLOW'
}
