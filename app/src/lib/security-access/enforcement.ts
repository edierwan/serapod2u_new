import type {
  AuditClass,
  AuditSensitivity,
  AuthorizationDecisionValue,
  AuthorizationReasonCode,
  MigrationMode,
  ShadowComparison,
} from './types'

/**
 * The single definition of what each migration mode means. Every enforcement
 * path goes through authorize()/requireAuthorization(), which use only these
 * functions, so no route can implement a slightly different mode.
 *
 *   LEGACY_ENFORCED  legacy outcome controls
 *   SHADOW           legacy outcome controls; new decision compared and logged
 *   NEW_ENFORCED     new S&A outcome controls; legacy is diagnostic only and a
 *                    legacy ALLOW can never override a new DENY
 *   LEGACY_RETIRED   new S&A outcome controls; legacy is not consulted
 */
export function isNewAuthoritative(mode: MigrationMode): boolean {
  return mode === 'NEW_ENFORCED' || mode === 'LEGACY_RETIRED'
}

export function consultsLegacy(mode: MigrationMode): boolean {
  return mode !== 'LEGACY_RETIRED'
}

export interface OutcomeInput {
  mode: MigrationMode
  actorActive: boolean
  legacyDecision: AuthorizationDecisionValue | null
  newDecision: AuthorizationDecisionValue
  newReasonCode: AuthorizationReasonCode
}

export function authoritativeOutcome(input: OutcomeInput): {
  decision: AuthorizationDecisionValue
  reasonCode: AuthorizationReasonCode
} {
  // Explicit active-account gate in every mode; legacy permission resolution
  // does not look at users.is_active.
  if (!input.actorActive) return { decision: 'DENY', reasonCode: 'ACCOUNT_INACTIVE' }
  if (isNewAuthoritative(input.mode)) {
    return { decision: input.newDecision, reasonCode: input.newReasonCode }
  }
  return input.legacyDecision === 'ALLOW'
    ? { decision: 'ALLOW', reasonCode: 'LEGACY_ALLOWED' }
    : { decision: 'DENY', reasonCode: 'LEGACY_DENIED' }
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

/** A decision the database backstop cannot see must not be allowed to proceed. */
export function auditWriteFailureIsFatal(mode: MigrationMode): boolean {
  return isNewAuthoritative(mode)
}
