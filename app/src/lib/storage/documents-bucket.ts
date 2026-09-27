import type { SupabaseClient } from '@supabase/supabase-js'
import { withStorageApiKey } from '@/lib/utils'

/**
 * The `documents` storage bucket is private (migration
 * 20260928170000_documents_storage_private_boundary). Browsers never read it
 * directly: every object is delivered by a server route that has already
 * authorized the caller, using the service role for the storage call.
 *
 * Stored references stay in whatever shape they were written (legacy
 * public-object URL, signed URL or bare object path). These helpers turn a
 * reference into an object path and check that the path belongs to the
 * record that referenced it, so a user-editable value can never be used to
 * reach another object in the bucket.
 */
export const DOCUMENTS_BUCKET = 'documents'

export const SIGNED_URL_TTL_SECONDS = 300

const OBJECT_MARKERS = [
  `/storage/v1/object/public/${DOCUMENTS_BUCKET}/`,
  `/storage/v1/object/sign/${DOCUMENTS_BUCKET}/`,
  `/storage/v1/object/authenticated/${DOCUMENTS_BUCKET}/`,
  `/object/public/${DOCUMENTS_BUCKET}/`,
  `/object/sign/${DOCUMENTS_BUCKET}/`,
  `/object/authenticated/${DOCUMENTS_BUCKET}/`,
]

/**
 * Object path inside the documents bucket for a stored reference, or null
 * when the reference is not a documents-bucket object (other bucket, other
 * host, traversal).
 */
export function documentsObjectPath(reference: string | null | undefined): string | null {
  const trimmed = String(reference ?? '').trim()
  if (!trimmed) return null

  let path: string | null = null
  if (/^https?:\/\//i.test(trimmed)) {
    let pathname: string
    try {
      pathname = new URL(trimmed).pathname
    } catch {
      return null
    }
    for (const marker of OBJECT_MARKERS) {
      const index = pathname.indexOf(marker)
      if (index >= 0) {
        path = pathname.slice(index + marker.length)
        break
      }
    }
  } else {
    path = trimmed.replace(/^\/+/, '')
    if (path.startsWith(`${DOCUMENTS_BUCKET}/`)) path = path.slice(DOCUMENTS_BUCKET.length + 1)
  }

  if (!path) return null
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  if (!path || path.includes('..') || path.includes('\\') || path.startsWith('/')) return null
  return path
}

/** True when the path is inside `<prefix>` (prefix must end with '/'). */
export function isDocumentsPathUnder(path: string | null, prefix: string): path is string {
  return Boolean(path && prefix.endsWith('/') && path.startsWith(prefix) && path.length > prefix.length)
}

/**
 * Signature images use `signatures/<owner user id>/<file>` for every new
 * upload. Historical objects used `signatures/<owner user id>_<timestamp>.<ext>`.
 * Accept only those two exact, owner-derived shapes so a persisted profile
 * value cannot be changed to sign or download another user's object.
 */
export function userSignaturePath(reference: string | null | undefined, ownerUserId: string): string | null {
  const path = documentsObjectPath(reference)
  const owner = String(ownerUserId ?? '').trim()
  if (!path || !/^[A-Za-z0-9-]+$/.test(owner)) return null

  const nestedPrefix = `signatures/${owner}/`
  if (path.startsWith(nestedPrefix)) {
    const filename = path.slice(nestedPrefix.length)
    return filename && /^[A-Za-z0-9._-]+$/.test(filename) ? path : null
  }

  const legacyPrefix = `signatures/${owner}_`
  if (path.startsWith(legacyPrefix)) {
    const legacyFilename = path.slice(legacyPrefix.length)
    return /^[0-9]+\.[A-Za-z0-9]+$/.test(legacyFilename) ? path : null
  }

  return null
}

/** Historical and current quality evidence lives below quality_issues/. */
export function qualityIssueEvidencePath(reference: string | null | undefined): string | null {
  const path = documentsObjectPath(reference)
  return isDocumentsPathUnder(path, 'quality_issues/') ? path : null
}

/** Short-lived signed URL for an already-authorized documents-bucket object. */
export async function createDocumentsSignedUrl(
  admin: SupabaseClient,
  path: string,
  expiresInSeconds = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const { data, error } = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, expiresInSeconds)
  if (error || !data?.signedUrl) return null
  return withStorageApiKey(data.signedUrl)
}
