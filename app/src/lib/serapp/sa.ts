import 'server-only'
import { authorizeOperation, organizationResource } from '@/lib/security-access/operation'

/**
 * S&A decision for a Serapp (distributor ordering channel) operation in the
 * actor's own organization. The Serapp access rule (distributor / HQ support)
 * is the legacy evaluator. Failure denies.
 */
export async function serappAllowed(userId: string, organizationId: string | null | undefined, permission: string, legacyAllowed: boolean) {
  if (!organizationId) return false
  return authorizeOperation({
    actorId: userId,
    permission,
    resource: organizationResource('serapp', organizationId),
    legacy: () => legacyAllowed,
  }).then(d => d.decision === 'ALLOW').catch(() => false)
}
