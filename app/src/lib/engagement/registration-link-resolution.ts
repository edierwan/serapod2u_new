import { samePhone } from '@/utils/phone'

import {
  INVALID_SIGNUP_REFERENCE_SELECTION_MESSAGE,
  INVALID_SIGNUP_SHOP_SELECTION_MESSAGE,
} from './registration-link-selection'

export interface RegistrationLinkResolutionInput {
  organizationId?: string | null
  shopName?: string | null
  referenceUserId?: string | null
  referralPhone?: string | null
}

export interface RegistrationLinkResolutionSuccess {
  ok: true
  organizationId: string
  organizationName: string
  shopDisplayName: string
  referenceUserId: string
  referralPhone: string | null
  referenceDisplayName: string | null
}

export interface RegistrationLinkResolutionFailure {
  ok: false
  field: 'reference' | 'shop'
  error: string
}

function normalizeLabel(value?: string | null) {
  return (value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function buildShopDisplayName(orgName?: string | null, branch?: string | null) {
  const normalizedOrgName = (orgName || '').trim()
  const normalizedBranch = (branch || '').trim()

  return normalizedBranch
    ? `${normalizedOrgName} (${normalizedBranch})`
    : normalizedOrgName
}

export async function resolveRegistrationLinkSelection(
  supabaseAdmin: any,
  input: RegistrationLinkResolutionInput,
): Promise<RegistrationLinkResolutionSuccess | RegistrationLinkResolutionFailure> {
  const organizationId = input.organizationId?.trim() || ''
  if (!organizationId) {
    return {
      ok: false,
      field: 'shop',
      error: INVALID_SIGNUP_SHOP_SELECTION_MESSAGE,
    }
  }

  const { data: organization } = await supabaseAdmin
    .from('organizations')
    .select('id, org_name, branch, org_type_code, is_active')
    .eq('id', organizationId)
    .maybeSingle()

  if (!organization || !organization.is_active || organization.org_type_code !== 'SHOP') {
    return {
      ok: false,
      field: 'shop',
      error: INVALID_SIGNUP_SHOP_SELECTION_MESSAGE,
    }
  }

  const shopDisplayName = buildShopDisplayName(organization.org_name, organization.branch)
  const submittedShopName = normalizeLabel(input.shopName)
  const allowedShopNames = new Set([
    normalizeLabel(shopDisplayName),
    normalizeLabel(organization.org_name),
  ].filter(Boolean))

  if (submittedShopName && !allowedShopNames.has(submittedShopName)) {
    return {
      ok: false,
      field: 'shop',
      error: INVALID_SIGNUP_SHOP_SELECTION_MESSAGE,
    }
  }

  const referenceUserId = input.referenceUserId?.trim() || ''
  if (!referenceUserId) {
    return {
      ok: false,
      field: 'reference',
      error: INVALID_SIGNUP_REFERENCE_SELECTION_MESSAGE,
    }
  }

  const { data: referenceUser } = await supabaseAdmin
    .from('users')
    .select('id, phone, full_name, call_name, can_be_reference, is_active')
    .eq('id', referenceUserId)
    .maybeSingle()

  if (!referenceUser || !referenceUser.can_be_reference || !referenceUser.is_active) {
    return {
      ok: false,
      field: 'reference',
      error: INVALID_SIGNUP_REFERENCE_SELECTION_MESSAGE,
    }
  }

  const submittedReferralPhone = input.referralPhone?.trim() || ''
  if (submittedReferralPhone && !samePhone(referenceUser.phone, submittedReferralPhone)) {
    return {
      ok: false,
      field: 'reference',
      error: INVALID_SIGNUP_REFERENCE_SELECTION_MESSAGE,
    }
  }

  return {
    ok: true,
    organizationId: organization.id,
    organizationName: organization.org_name,
    shopDisplayName,
    referenceUserId: referenceUser.id,
    referralPhone: referenceUser.phone || null,
    referenceDisplayName: referenceUser.call_name?.trim() || referenceUser.full_name?.trim() || null,
  }
}