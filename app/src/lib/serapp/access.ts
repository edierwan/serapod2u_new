/**
 * Serapp access rules (distributor mobile PWA).
 *
 * In Scope v1:
 * - Portal users belonging to an active Distributor (DIST) organization.
 * - HQ users may open Serapp for support / UAT (read distributor context later).
 *
 * Out of Scope v1:
 * - Shop / Manufacturer / Warehouse-only accounts as primary Serapp actors.
 */

export type SerappOrgType = 'DIST' | 'HQ' | 'WH' | 'SHOP' | 'MFG' | string

export interface SerappAccessInput {
  accountScope: string | null | undefined
  orgTypeCode: SerappOrgType | null | undefined
  organizationId: string | null | undefined
  roleLevel: number | null | undefined
}

export interface SerappAccessDecision {
  allowed: boolean
  reason: string
  isDistributor: boolean
  isHqSupport: boolean
}

/** Default landing route after login for Serapp-eligible portal users (distributors first). */
export function getSerappDefaultPath(decision: SerappAccessDecision): string | null {
  if (!decision.allowed) return null
  if (decision.isDistributor) return '/serapp/conversation'
  return null
}

/** Portal home route from org type (pure — safe for middleware / edge). */
export function resolvePortalHomePath(
  input: Pick<SerappAccessInput, 'accountScope' | 'orgTypeCode' | 'organizationId' | 'roleLevel'>,
): string {
  const access = getSerappAccessDecision(input)
  return getSerappDefaultPath(access) || '/dashboard'
}

export function getSerappAccessDecision(input: SerappAccessInput): SerappAccessDecision {
  const isPortal = input.accountScope === 'portal' && Boolean(input.organizationId)
  const orgType = (input.orgTypeCode || '').toUpperCase()
  const isDistributor = orgType === 'DIST'
  const isHqSupport = orgType === 'HQ'

  if (!isPortal) {
    return {
      allowed: false,
      reason: 'Serapp is available only for business portal accounts.',
      isDistributor,
      isHqSupport,
    }
  }

  if (isDistributor) {
    return {
      allowed: true,
      reason: 'Distributor portal access granted.',
      isDistributor: true,
      isHqSupport: false,
    }
  }

  if (isHqSupport) {
    return {
      allowed: true,
      reason: 'HQ support access granted for Serapp UAT.',
      isDistributor: false,
      isHqSupport: true,
    }
  }

  return {
    allowed: false,
    reason: `Organization type ${orgType || 'unknown'} is not enabled for Serapp yet.`,
    isDistributor: false,
    isHqSupport: false,
  }
}
