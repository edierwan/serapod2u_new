import 'server-only'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPermissionForUser } from '@/lib/server/permissions'
import { evaluateNewPolicy, type PolicyAssignment, type PolicyMembership } from './policy'
import { shadowComparisonFor } from './comparison'
import type { AuthorizationDecision, AuthorizationRequest, MigrationMode } from './types'

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

async function loadNewPolicy(request: AuthorizationRequest) {
  const admin = createAdminClient() as any
  const results = await Promise.all([
    admin.from('users').select('id,is_active').eq('id', request.actorId).maybeSingle(),
    admin.from('sa_organization_memberships').select('id,organization_id,status,effective_from,effective_until').eq('user_id', request.actorId),
    admin.from('sa_role_assignments').select(`
      id,status,effective_from,effective_until,membership_id,
      role:sa_business_roles!inner(id,role_key,name,status,permissions:sa_business_role_permissions(permission:sa_permissions(permission_key))),
      scopes:sa_assignment_scopes(scope:sa_scope_definitions(scope_type,scope_value))
    `).eq('user_id', request.actorId),
  ])
  if (results.some((result: any) => result.error)) throw new Error('policy_data_unavailable')
  const [{ data: actor }, { data: memberships }, { data: assignments }] = results

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
  return { actorActive: actor?.is_active === true, memberships: mappedMemberships, assignments: mappedAssignments }
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

export async function authorize(request: AuthorizationRequest, options: { log?: boolean } = {}): Promise<AuthorizationDecision> {
  const decisionId = randomUUID()
  const mode = await migrationMode(request.permission)
  const legacy = await checkPermissionForUser(request.actorId, legacyPermissionFor(request.permission))
  const legacyDecision = legacy.allowed ? 'ALLOW' as const : 'DENY' as const
  let evaluated: ReturnType<typeof evaluateNewPolicy> | {
    decision: 'DENY'; reasonCode: 'POLICY_ERROR'; matchedAssignments: []; resolvedScopes: []
  }
  try {
    evaluated = evaluateNewPolicy(request, await loadNewPolicy(request))
  } catch {
    evaluated = { decision: 'DENY', reasonCode: 'POLICY_ERROR', matchedAssignments: [], resolvedScopes: [] }
  }

  const authoritative = mode === 'NEW_ENFORCED' || mode === 'LEGACY_RETIRED' ? evaluated.decision : legacyDecision
  const result: AuthorizationDecision = {
    decision: authoritative,
    permission: request.permission,
    actor: request.actorId,
    matchedAssignments: evaluated.matchedAssignments,
    resolvedScopes: evaluated.resolvedScopes,
    reasonCode: mode === 'NEW_ENFORCED' || mode === 'LEGACY_RETIRED'
      ? evaluated.reasonCode
      : (legacy.allowed ? 'LEGACY_ALLOWED' : 'LEGACY_DENIED'),
    policyVersion: POLICY_VERSION,
    decisionId,
    migrationMode: mode,
    legacyDecision,
    newDecision: evaluated.decision,
  }

  if (options.log !== false && !request.context?.explainOnly) {
    const admin = createAdminClient() as any
    await admin.from('sa_authorization_decisions').insert({
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
      comparison: shadowComparisonFor(legacyDecision, evaluated.decision, evaluated.reasonCode),
      correlation_id: request.context?.correlationId ?? request.context?.requestId ?? null,
      policy_version: POLICY_VERSION,
    })
  }
  return result
}

export async function requireAuthorization(request: AuthorizationRequest): Promise<AuthorizationDecision> {
  const decision = await authorize(request)
  if (decision.decision !== 'ALLOW') {
    const error = new Error('Forbidden') as Error & { decisionId?: string; reasonCode?: string }
    error.decisionId = decision.decisionId
    error.reasonCode = decision.reasonCode
    throw error
  }
  return decision
}
