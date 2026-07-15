import type { SupabaseClient } from '@supabase/supabase-js'
import { extractStoragePath, isSupabaseStorageUrl, withStorageApiKey } from '@/lib/utils'

/**
 * User signatures are uploaded to `documents/signatures/…` (see
 * SignatureUpload.tsx) but persisted as raw public-object URLs. Those cannot
 * be loaded directly by an <img>: the self-hosted Kong gateway rejects
 * storage requests without an `apikey`, and the `documents` bucket may be
 * private in some environments. Re-signing the object path covers both, and
 * also revives values that still point at a retired legacy storage host.
 */
const SIGNATURE_BUCKET = 'documents'

/**
 * Resolves a persisted user signature value (public-style URL — current or
 * legacy host — or a relative storage path) into a URL an <img> can load,
 * or null when no displayable URL can be produced.
 */
export async function resolveUserSignatureUrl(
  supabase: SupabaseClient<any, any, any>,
  value: unknown,
  expiresInSeconds = 3600,
): Promise<string | null> {
  if (typeof value !== 'string') return null

  const stored = value.trim()
  if (!stored) return null

  const isAbsolute = /^https?:\/\//i.test(stored)
  if (isAbsolute && !isSupabaseStorageUrl(stored)) {
    // External (non-Supabase-storage) URL — nothing to re-sign.
    return stored
  }

  const objectPath = extractStoragePath(stored)
  if (!objectPath || objectPath.includes('..')) return null

  const { data, error } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .createSignedUrl(objectPath, expiresInSeconds)

  if (error || !data?.signedUrl) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[signature] Unable to sign signature URL:', error?.message ?? 'no signed URL returned')
    }
    return null
  }

  return withStorageApiKey(data.signedUrl)
}
