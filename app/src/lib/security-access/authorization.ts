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
  AuthorizationResource,
  AuthorizationDecisionValue,
  AuthorizationReasonCode,
  AuthorizationRequest,
  MigrationMode,
} from './types'

const POLICY_VERSION = 'sa-final-v1'

/**
 * Legacy decision supplied by the caller: the module's existing check
 * (canManageHr, role_level thresholds, organization-type rules, ...). It is
 * evaluated exactly as before so LEGACY_ENFORCED/SHADOW keep today's behaviour,
 * and it is never consulted once the permission is LEGACY_RETIRED.
 */
export type LegacyEvaluator = () => boolean | Promise<boolean>

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

/** Current migration mode of a permission (LEGACY_ENFORCED when not seeded yet). */
export async function currentMigrationMode(permission: string): Promise<MigrationMode> {
  return migrationMode(permission)
}

// Unknown, missing, or unreadable sensitivity is treated as protected.
async function auditSensitivity(permission: string): Promise<AuditSensitivity> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('sa_permissions').select('audit_sensitivity').eq('permission_key', permission).maybeSingle()
  return !error && data?.audit_sensitivity === 'ordinary' ? 'ordinary' : 'security_sensitive'
}

async function legacyDecisionFor(request: AuthorizationRequest, mode: MigrationMode, evaluator?: LegacyEvaluator): Promise<AuthorizationDecisionValue | null> {
  if (!consultsLegacy(mode)) return null
  try {
    if (evaluator) return (await evaluator()) ? 'ALLOW' : 'DENY'
    const legacy = await checkPermissionForUser(request.actorId, legacyPermissionFor(request.permission))
    return legacy.allowed ? 'ALLOW' : 'DENY'
  } catch (error) {
    // Diagnostic only once the new engine is authoritative; never a reason to
    // allow and never a reason to break an enforced operation.
    if (isNewAuthoritative(mode)) return null
    throw error
  }
}

/** Resource context for the database evaluator (keys mirror sa_scope_matches). */
export function databaseContext(resource: AuthorizationResource): Record<string, unknown> {
  return {
    ...(resource.organizationId ? { organization_id: resource.organizationId } : {}),
    ...(resource.warehouseId ? { warehouse_id: resource.warehouseId } : {}),
    ...(resource.departmentId ? { department_id: resource.departmentId } : {}),
    ...(resource.ownerUserId ? { owner_user_id: resource.ownerUserId } : {}),
    ...(resource.attributes && Object.keys(resource.attributes).length ? { attributes: resource.attributes } : {}),
  }
}

const EVALUATOR_UNAVAILABLE = new Set(['PGRST202', '42883', 'PGRST205'])

type NewEvaluation = ReturnType<typeof evaluateNewPolicy> | {
  decision: AuthorizationDecisionValue; reasonCode: AuthorizationReasonCode; matchedAssignments: any[]; resolvedScopes: any[]
}

/**
 * Canonical new-model decision: the database evaluator
 * (public.sa_evaluate_permission — the same function the RLS/RPC backstops
 * use, including hierarchy-aware scopes and non-transitive delegation). The
 * in-process evaluator is used only while the Final Wave migration is not yet
 * applied in an environment (code-before-migration rollout).
 */
async function evaluateNew(request: AuthorizationRequest, actorActive: boolean): Promise<NewEvaluation> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.rpc('sa_evaluate_permission', {
    p_actor: request.actorId, p_permission: request.permission, p_context: databaseContext(request.resource), p_include_delegation: true,
  })
  if (!error && data && typeof data === 'object' && (data.decision === 'ALLOW' || data.decision === 'DENY')) {
    return {
      decision: data.decision,
      reasonCode: data.reason_code as AuthorizationReasonCode,
      matchedAssignments: Array.isArray(data.matched_assignments) ? data.matched_assignments : [],
      resolvedScopes: Array.isArray(data.resolved_scopes) ? data.resolved_scopes : [],
    }
  }
  if (error && !EVALUATOR_UNAVAILABLE.has(error.code)) throw new Error('policy_evaluation_failed')
  return evaluateNewPolicy(request, { actorActive, ...(await loadNewPolicy(request)) })
}

export async function authorize(
  request: AuthorizationRequest,
  options: { log?: boolean; legacy?: LegacyEvaluator } = {},
): Promise<AuthorizationDecision> {
  const decisionId = randomUUID()
  const shouldLog = options.log !== false && !request.context?.explainOnly
  const [mode, actorActive, sensitivity] = await Promise.all([
    migrationMode(request.permission),
    isActiveSecurityAccessAccount(request.actorId),
    shouldLog ? auditSensitivity(request.permission) : Promise.resolve<AuditSensitivity>('security_sensitive'),
  ])
  const legacyDecision = await legacyDecisionFor(request, mode, options.legacy)
  let evaluated: NewEvaluation
  try {
    evaluated = actorActive
      ? await evaluateNew(request, actorActive)
      : { decision: 'DENY', reasonCode: 'ACCOUNT_INACTIVE', matchedAssignments: [], resolvedScopes: [] }
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
export async function requireAuthorization(request: AuthorizationRequest, options: { legacy?: LegacyEvaluator } = {}): Promise<AuthorizationDecision> {
  const decision = await authorize(request, { legacy: options.legacy })
  if (decision.decision !== 'ALLOW') throw new AuthorizationDeniedError(decision.decisionId, decision.reasonCode)
  return decision
}
