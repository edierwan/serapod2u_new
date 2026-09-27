import 'server-only'
import { authorizeOperation, organizationResource } from './operation'
import type { LegacyEvaluator } from './authorization'

/**
 * S&A decision for a Finance operation. `organizationId` is the organization
 * whose financial data the route reads or writes, taken from the verified
 * user's profile (or the company resolved from it) — never from the request.
 * The legacy evaluator is the route's historical check. Failure denies.
 */
export async function financeAllowed(
  userId: string,
  permission: string,
  legacy: LegacyEvaluator,
  organizationId: string | null | undefined,
): Promise<boolean> {
  if (!organizationId) return false
  try {
    const decision = await authorizeOperation({
      actorId: userId,
      permission,
      resource: organizationResource('finance_company', organizationId),
      legacy,
    })
    return decision.decision === 'ALLOW'
  } catch {
    return false
  }
}
