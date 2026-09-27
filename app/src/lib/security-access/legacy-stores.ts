import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * True once Security & Access is the only writable authorization source in
 * this environment (sa_settings 'legacy_authorization.read_only'). Legacy
 * editors (role permissions, department overrides, HR access groups, the
 * Finance role matrix) become read-only; the database enforces the same
 * switch. Unknown/unavailable state is reported as writable only while the
 * Final Wave migration is absent, matching the database (no switch → no lock).
 */
export async function legacyAuthorizationReadOnly(): Promise<boolean> {
  const admin = createAdminClient() as any
  const { data, error } = await admin.rpc('sa_legacy_authorization_read_only')
  if (error) return false
  return data === true
}

export const LEGACY_STORE_READ_ONLY_RESPONSE = {
  success: false,
  error: 'This legacy authorization setting is read-only. Access is administered in Security & Access.',
  code: 'legacy_authorization_read_only',
  managedIn: '/security-access',
} as const
