type SupabaseAdminClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: any }>
}

export type LoyaltyProgramCode = 'cellera' | 'ellbow'
export type LoyaltyParticipantType = 'organization_user' | 'shop_staff' | 'consumer'
export type LoyaltyEnrollmentSource = 'legacy_backfill' | 'roadtour' | 'legacy_registration' | 'admin'

export interface LoyaltyMembershipContext {
  ownerOrganizationId?: string | null
  memberOrganizationId?: string | null
  firstRoadtourRunId?: string | null
  firstCampaignId?: string | null
  createdBy?: string | null
}

export async function upsertOrganizationProgramMembership(
  admin: SupabaseAdminClient,
  programCode: LoyaltyProgramCode,
  memberOrganizationId: string | null | undefined,
  enrollmentSource: LoyaltyEnrollmentSource,
  context: LoyaltyMembershipContext = {},
) {
  if (!memberOrganizationId) return null

  const { data, error } = await admin.rpc('loyalty_program_upsert_organization_membership', {
    p_program_code: programCode,
    p_member_organization_id: memberOrganizationId,
    p_enrollment_source: enrollmentSource,
    p_owner_organization_id: context.ownerOrganizationId || null,
    p_first_roadtour_run_id: context.firstRoadtourRunId || null,
    p_first_campaign_id: context.firstCampaignId || null,
    p_created_by: context.createdBy || null,
    p_status: 'active',
  })

  if (error) {
    throw new Error(error.message || `Failed to upsert ${programCode} organization membership.`)
  }

  return data as string | null
}

export async function upsertUserProgramMembership(
  admin: SupabaseAdminClient,
  programCode: LoyaltyProgramCode,
  userId: string | null | undefined,
  participantType: LoyaltyParticipantType,
  enrollmentSource: LoyaltyEnrollmentSource,
  context: LoyaltyMembershipContext = {},
) {
  if (!userId) return null

  const { data, error } = await admin.rpc('loyalty_program_upsert_user_membership', {
    p_program_code: programCode,
    p_user_id: userId,
    p_participant_type: participantType,
    p_enrollment_source: enrollmentSource,
    p_member_organization_id: context.memberOrganizationId || null,
    p_owner_organization_id: context.ownerOrganizationId || null,
    p_first_roadtour_run_id: context.firstRoadtourRunId || null,
    p_first_campaign_id: context.firstCampaignId || null,
    p_created_by: context.createdBy || null,
    p_status: 'active',
  })

  if (error) {
    throw new Error(error.message || `Failed to upsert ${programCode} user membership.`)
  }

  return data as string | null
}

export async function upsertProgramMembershipsForUserAndOrganization(params: {
  admin: SupabaseAdminClient
  programCode: LoyaltyProgramCode
  userId?: string | null
  memberOrganizationId?: string | null
  participantType: LoyaltyParticipantType
  enrollmentSource: LoyaltyEnrollmentSource
  context?: Omit<LoyaltyMembershipContext, 'memberOrganizationId'>
}) {
  const context = {
    ...params.context,
    memberOrganizationId: params.memberOrganizationId || null,
  }

  const [organizationMembershipId, userMembershipId] = await Promise.all([
    upsertOrganizationProgramMembership(
      params.admin,
      params.programCode,
      params.memberOrganizationId,
      params.enrollmentSource,
      context,
    ),
    upsertUserProgramMembership(
      params.admin,
      params.programCode,
      params.userId,
      params.participantType,
      params.enrollmentSource,
      context,
    ),
  ])

  return { organizationMembershipId, userMembershipId }
}
