import type {
  AuditClass,
  AuditSensitivity,
  AuthorizationReasonCode,
  MigrationMode,
  ShadowComparison,
} from './types'

/** The new S&A engine is the authoritative decision in these modes. */
export function isNewAuthoritative(mode: MigrationMode): boolean {
  return mode === 'NEW_ENFORCED' || mode === 'LEGACY_RETIRED'
}

/**
 * Explicit write-time audit classification. Precedence: policy errors and
 * security-sensitive permissions are always protected; any decision the new
 * engine enforced is protected; only a non-authoritative comparison on a
 * permission catalogued as ordinary is purgeable. The database re-validates
 * this on insert (sa_validate_decision_audit_class).
 */
export function auditClassFor(input: {
  mode: MigrationMode
  sensitivity: AuditSensitivity
  comparison: ShadowComparison
  reasonCode: AuthorizationReasonCode
}): AuditClass {
  if (input.comparison === 'POLICY_ERROR' || input.reasonCode === 'POLICY_ERROR') return 'POLICY_ERROR'
  if (input.sensitivity !== 'ordinary') return 'SECURITY_SENSITIVE'
  if (isNewAuthoritative(input.mode)) return 'ENFORCED_DECISION'
  return 'ORDINARY_SHADOW'
}
