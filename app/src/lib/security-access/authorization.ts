import 'server-only'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPermissionForUser } from '@/lib/server/permissions'
import { isActiveSecurityAccessAccount } from './active-account'
import { evaluateNewPolicy, type PolicyAssignment, type PolicyMembership } from './policy'
import { shadowComparisonFor } from './comparison'
import { auditClassFor, auditWriteFailureIsFatal, authoritativeOutcome, consultsLegacy, isNewAuthoritative } from './enforcement'
import type {
  AuditSensitivity,
  AuthorizationDecision,
  AuthorizationDecisionValue,
  AuthorizationReasonCode,
  AuthorizationRequest,
  MigrationMode,
} from './types'

const POLICY_VERSION = 'sa-wave1-v1'

const legacyPermissionFor = (permission: string) => ({
  'inventory.stock_count.view': 'view_inventory',
  'inventory.stock_count.create': 'adjust_stock',
  'inventory.stock_count.verify': 'post_stock_count',
  'inventory.stock_count.post': 'post_stock_count',
  'inventory.transfer.view': 'view_inventory',
  'inventory.transfer.request': 'adjust_stock',
  'inventory.transfer.approve': 'adjust_stock',
  'inventory.transfer.dispatch': 'ship_goods',
  'inventory.transfer.receive': 'receive_goods',
  'security.access.view': 'view_users',
  'security.role.assign': 'manage_authorization',
} as Record<string, string>)[permission] ?? permission

/** Thrown by requireAuthorization when the authoritative decision is DENY. */
export class AuthorizationDeniedError extends Error {
  readonly status = 403
  constructor(readonly decisionId: string, readonly reasonCode: AuthorizationReasonCode) {
    super('Forbidden')
    this.name = 'AuthorizationDeniedError'
  }
}

export function isAuthorizationDenied(error: unknown): error is AuthorizationDeniedError {
  return error instanceof AuthorizationDeniedError
}

async function loadNewPolicy(request: AuthorizationRequest) {
  const admin = createAdminClient() as any
  const results = await Promise.all([
    admin.from('sa_organization_memberships').select('id,organization_id,status,effective_from,effective_until').eq('user_id', request.actorId),
    admin.from('sa_role_assignments').select(`
      id,status,effective_from,effective_until,membership_id,
      role:sa_business_roles!inner(id,role_key,name,status,permissions:sa_business_role_permissions(permission:sa_permissions(permission_key))),
      scopes:sa_assignment_scopes(scope:sa_scope_definitions(scope_type,scope_value))
    `).eq('user_id', request.actorId),
  ])
  if (results.some((result: any) => result.error)) throw new Error('policy_data_unavailable')
  const [{ data: memberships }, { data: assignments }] = results

  const mappedMemberships: PolicyMembership[] = (memberships || []).map((m: any) => ({
    id: m.id, organizationId: m.organization_id, status: m.status,
    effectiveFrom: m.effective_from, effectiveUntil: m.effective_until,
  }))
  const mappedAssignments: PolicyAssignment[] = (assignments || []).map((a: any) => ({
    assignmentId: a.id,
    roleId: a.role.id,
    roleKey: a.role.role_key,
    roleName: a.role.name,
    membershipId: a.membership_id,
    status: a.status,
    effectiveFrom: a.effective_from,
    effectiveUntil: a.effective_until,
    permissions: (a.role.permissions || []).map((p: any) => p.permission?.permission_key).filter(Boolean),
    scopes: (a.scopes || []).map((s: any) => ({ type: s.scope?.scope_type, value: s.scope?.scope_value })).filter((s: any) => s.type && s.value),
  }))
  return { memberships: mappedMemberships, assignments: mappedAssignments }
}

async function migrationMode(permission: string): Promise<MigrationMode> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('sa_migration_modes').select('mode').eq('permission_key', permission).maybeSingle()
  // Compatibility during code-before-migration rollout only. Other lookup
  // failures are policy errors, never permission to fall back from a configured
  // NEW_ENFORCED decision.
  if (error && error.code !== 'PGRST205' && error.code !== '42P01') throw new Error('migration_mode_unavailable')
  return data?.mode ?? 'LEGACY_ENFORCED'
}

// Unknown, missing, or unreadable sensitivity is treated as protected.
async function auditSensitivity(permission: string): Promise<AuditSensitivity> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('sa_permissions').select('audit_sensitivity').eq('permission_key', permission).maybeSingle()
  return !error && data?.audit_sensitivity === 'ordinary' ? 'ordinary' : 'security_sensitive'
}

async function legacyDecisionFor(request: AuthorizationRequest, mode: MigrationMode): Promise<AuthorizationDecisionValue | null> {
  if (!consultsLegacy(mode)) return null
  try {
    const legacy = await checkPermissionForUser(request.actorId, legacyPermissionFor(request.permission))
    return legacy.allowed ? 'ALLOW' : 'DENY'
  } catch (error) {
    // Diagnostic only once the new engine is authoritative; never a reason to
    // allow and never a reason to break an enforced operation.
    if (isNewAuthoritative(mode)) return null
    throw error
  }
}

export async function authorize(request: AuthorizationRequest, options: { log?: boolean } = {}): Promise<AuthorizationDecision> {
  const decisionId = randomUUID()
  const shouldLog = options.log !== false && !request.context?.explainOnly
  const [mode, actorActive, sensitivity] = await Promise.all([
    migrationMode(request.permission),
    isActiveSecurityAccessAccount(request.actorId),
    shouldLog ? auditSensitivity(request.permission) : Promise.resolve<AuditSensitivity>('security_sensitive'),
  ])
  const legacyDecision = await legacyDecisionFor(request, mode)
  let evaluated: ReturnType<typeof evaluateNewPolicy> | {
    decision: 'DENY'; reasonCode: 'POLICY_ERROR'; matchedAssignments: []; resolvedScopes: []
  }
  try {
    evaluated = evaluateNewPolicy(request, { actorActive, ...(await loadNewPolicy(request)) })
  } catch {
    evaluated = { decision: 'DENY', reasonCode: 'POLICY_ERROR', matchedAssignments: [], resolvedScopes: [] }
  }

  const outcome = authoritativeOutcome({
    mode, actorActive, legacyDecision, newDecision: evaluated.decision, newReasonCode: evaluated.reasonCode,
  })
  const comparison = shadowComparisonFor(legacyDecision, evaluated.decision, evaluated.reasonCode)
  const auditClass = auditClassFor({ mode, sensitivity, comparison, reasonCode: outcome.reasonCode })
  const result: AuthorizationDecision = {
    decision: outcome.decision,
    permission: request.permission,
    actor: request.actorId,
    matchedAssignments: evaluated.matchedAssignments,
    resolvedScopes: evaluated.resolvedScopes,
    reasonCode: outcome.reasonCode,
    policyVersion: POLICY_VERSION,
    decisionId,
    migrationMode: mode,
    legacyDecision,
    newDecision: evaluated.decision,
    newReasonCode: evaluated.reasonCode,
    ...(shouldLog ? { auditClass } : {}),
  }

  if (shouldLog) {
    const admin = createAdminClient() as any
    const { error } = await admin.from('sa_authorization_decisions').insert({
      id: decisionId,
      actor_id: request.actorId,
      permission_key: request.permission,
      resource_type: request.resource.type,
      resource_id: request.resource.id ?? null,
      decision: result.decision,
      reason_code: result.reasonCode,
      matched_assignments: result.matchedAssignments,
      resolved_scopes: result.resolvedScopes,
      migration_mode: mode,
      legacy_decision: legacyDecision,
      new_decision: evaluated.decision,
      comparison,
      audit_class: auditClass,
      correlation_id: request.context?.correlationId ?? request.context?.requestId ?? null,
      policy_version: POLICY_VERSION,
    })
    if (error) {
      console.error('[sa-authorization] decision audit write failed', { decisionId, permission: request.permission, code: error.code })
      // The database backstop requires this row; an enforced ALLOW that was not
      // recorded fails closed. Non-authoritative modes keep legacy behavior.
      if (auditWriteFailureIsFatal(mode) && result.decision === 'ALLOW') {
        return { ...result, decision: 'DENY', reasonCode: 'POLICY_ERROR' }
      }
    }
  }
  return result
}

/**
 * Server-side enforcement helper. Evaluates and records the decision, then
 * enforces the authoritative outcome for the permission's migration mode
 * (see enforcement.ts). In NEW_ENFORCED / LEGACY_RETIRED a new-engine DENY
 * throws; there is no fallback to a legacy ALLOW.
 */
export async function requireAuthorization(request: AuthorizationRequest): Promise<AuthorizationDecision> {
  const decision = await authorize(request)
  if (decision.decision !== 'ALLOW') throw new AuthorizationDeniedError(decision.decisionId, decision.reasonCode)
  return decision
}
