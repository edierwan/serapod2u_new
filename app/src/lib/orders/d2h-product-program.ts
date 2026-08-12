export const CELLERA_PROGRAM_CODE = 'cellera'

interface OrganizationMembership {
  loyalty_program_id: string | null
  owner_organization_id: string | null
  status: string | null
}

interface LoyaltyProgram {
  id: string
  organization_id: string | null
  code: string | null
  active: boolean | null
}

/**
 * Program codes the distributor is an active member of, scoped to the seller HQ
 * that owns the program. This is the same source the Organizations list renders
 * in the Program column.
 */
export function activeProgramCodes(
  memberships: OrganizationMembership[],
  programs: LoyaltyProgram[],
  ownerOrganizationId: string,
): string[] {
  const activeProgramIds = new Set(
    memberships
      .filter(membership =>
        membership.status === 'active'
        && membership.owner_organization_id === ownerOrganizationId,
      )
      .map(membership => membership.loyalty_program_id)
      .filter((id): id is string => Boolean(id)),
  )

  return Array.from(new Set(
    programs
      .filter(program =>
        activeProgramIds.has(program.id)
        && program.organization_id === ownerOrganizationId
        && program.active === true,
      )
      .map(program => program.code)
      .filter((code): code is string => Boolean(code)),
  ))
}

export function hasActiveCelleraProgram(
  memberships: OrganizationMembership[],
  programs: LoyaltyProgram[],
  ownerOrganizationId: string,
): boolean {
  return activeProgramCodes(memberships, programs, ownerOrganizationId).includes(CELLERA_PROGRAM_CODE)
}

export async function resolveDistributorProgramCodes(
  admin: any,
  distributorId: string,
  ownerOrganizationId: string,
): Promise<string[]> {
  const { data: memberships, error: membershipError } = await admin
    .from('loyalty_program_organization_memberships')
    .select('loyalty_program_id, owner_organization_id, status')
    .eq('member_organization_id', distributorId)
    .eq('owner_organization_id', ownerOrganizationId)
    .eq('status', 'active')

  if (membershipError) throw new Error('Unable to resolve the distributor loyalty program.')

  const programIds = Array.from(new Set(
    (memberships || [])
      .map((membership: OrganizationMembership) => membership.loyalty_program_id)
      .filter((id: string | null): id is string => Boolean(id)),
  ))
  if (programIds.length === 0) return []

  const { data: programs, error: programsError } = await admin
    .from('loyalty_programs')
    .select('id, organization_id, code, active')
    .in('id', programIds)
    .eq('organization_id', ownerOrganizationId)
    .eq('active', true)

  if (programsError) throw new Error('Unable to resolve the distributor loyalty program.')

  return activeProgramCodes(
    (memberships || []) as OrganizationMembership[],
    (programs || []) as LoyaltyProgram[],
    ownerOrganizationId,
  )
}

export async function distributorHasActiveCelleraMembership(
  admin: any,
  distributorId: string,
  ownerOrganizationId: string,
): Promise<boolean> {
  const codes = await resolveDistributorProgramCodes(admin, distributorId, ownerOrganizationId)
  return codes.includes(CELLERA_PROGRAM_CODE)
}
