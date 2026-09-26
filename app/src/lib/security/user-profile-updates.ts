export const SELF_SERVICE_PROFILE_FIELDS = [
  'full_name',
  'call_name',
  'phone',
  'signature_url',
  'avatar_url',
  'location',
  'shop_name',
  'address',
  'referral_phone',
  'reference_user_id',
  'bank_id',
  'bank_account_number',
  'bank_account_holder_name',
] as const

// Storefront-only values persisted in Supabase Auth user_metadata. These are
// accepted only by the profile endpoint and must never be spread into
// public.users by updateUserWithAuth.
export const SELF_SERVICE_AUTH_METADATA_FIELDS = [
  'outdoor_phone',
  'outdoor_location',
] as const

const SELF_SERVICE_PROFILE_FIELD_SET = new Set<string>(SELF_SERVICE_PROFILE_FIELDS)

export const PROTECTED_USER_ACCESS_FIELDS = [
  'role_code',
  'organization_id',
  'account_scope',
  'is_active',
  'department_id',
  'manager_user_id',
  'position_id',
  'employment_type',
  'join_date',
  'employment_status',
  'can_be_reference',
  'permissions',
  'role_assignments',
] as const

export function getDisallowedSelfServiceFields(
  input: Record<string, unknown>,
  metadataFields: readonly string[] = [],
): string[] {
  const metadata = new Set(metadataFields)
  return Object.keys(input).filter(
    (key) => !SELF_SERVICE_PROFILE_FIELD_SET.has(key) && !metadata.has(key),
  )
}

export function pickSelfServiceProfileFields(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of SELF_SERVICE_PROFILE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      result[key] = input[key]
    }
  }
  return result
}
