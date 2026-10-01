import 'server-only'
import { hrCan, type HrAuthContext } from '@/lib/server/hrAccess'
import { resolveHrRole, type HrRole } from './policy'

/**
 * The HR assistant's data tier for the signed-in caller.
 *
 * The sensitive tiers are S&A decisions in the caller's organization:
 *   hr.compensation.view → HR_MANAGER (highly sensitive: salary, bank, IC)
 *   hr.employee.manage   → HR_STAFF   (sensitive: phone, address, DOB)
 * with the historical role-level classification as the legacy evaluator.
 *
 *   hr.employee.view_internal → MANAGER (internal: work email, hire date,
 *                                employment type; Stage 2D permission whose
 *                                role is backfilled to today's audience)
 */
export async function resolveHrRoleForCaller(
  ctx: Pick<HrAuthContext, 'userId' | 'organizationId' | 'roleCode' | 'roleLevel'>,
): Promise<HrRole> {
  const legacyRole = resolveHrRole(ctx.roleCode, ctx.roleLevel)
  if (await hrCan(ctx, 'hr.compensation.view', () => legacyRole === 'SUPER_ADMIN' || legacyRole === 'HR_MANAGER')) {
    return 'HR_MANAGER'
  }
  if (await hrCan(ctx, 'hr.employee.manage', () => legacyRole === 'HR_STAFF')) {
    return 'HR_STAFF'
  }
  if (await hrCan(ctx, 'hr.employee.view_internal', () => legacyRole !== 'EMPLOYEE')) {
    return 'MANAGER'
  }
  return 'EMPLOYEE'
}
