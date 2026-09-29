import 'server-only'
import { IDENTITY_BLOCK_MESSAGES, isIdentityBlockCode } from './resolution'

/**
 * Identity resolution for bulk imports (point migration). Uses the single
 * resolver, so imports follow the same rules as every other onboarding path:
 * an existing person is reused, a new person may be created, and conflicting
 * or unverified matches are refused per row and recorded for review — never
 * merged and never duplicated.
 */
export async function resolveImportIdentity(
  admin: any,
  email: string | null | undefined,
  phone: string | null | undefined,
  actorId: string | null,
): Promise<{ userId: string | null; create: boolean; error: string | null }> {
  const { data, error } = await admin.rpc('identity_resolve', { p_email: email?.trim() || null, p_phone: phone || null })
  if (error) return { userId: null, create: false, error: 'Identity lookup failed; the row was not imported.' }
  const outcome = data?.outcome
  if (outcome === 'MATCH') return { userId: data.user_id, create: false, error: null }
  if (outcome === 'NO_MATCH') return { userId: null, create: true, error: null }
  if (outcome === 'INVALID_INPUT') return { userId: null, create: false, error: 'Invalid email or phone number.' }
  if (isIdentityBlockCode(outcome)) {
    await admin.rpc('identity_record_conflict', {
      p_code: outcome, p_resolution: data, p_email: email?.trim() || null, p_phone: phone || null,
      p_source: 'import', p_actor: actorId, p_details: { stage: 'resolve' },
    })
    return { userId: null, create: false, error: IDENTITY_BLOCK_MESSAGES[outcome] }
  }
  return { userId: null, create: false, error: 'Identity could not be resolved; the row was not imported.' }
}
