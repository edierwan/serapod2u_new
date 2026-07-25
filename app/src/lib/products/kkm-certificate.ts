export const KKM_CERTIFICATE_BUCKET = 'kkm-certificates'
export const KKM_CERTIFICATE_MAX_FILE_SIZE = 10 * 1024 * 1024
const STORAGE_OBJECT_PREFIXES = ['sign', 'authenticated', 'public'] as const

const ACCEPTED_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

export function validateKkmCertificate(file: File): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  if (!ACCEPTED_TYPES[extension] || ACCEPTED_TYPES[extension] !== file.type) {
    return 'Certificate must be a PDF, JPG, JPEG or PNG file.'
  }
  if (file.size > KKM_CERTIFICATE_MAX_FILE_SIZE) return 'Certificate must be 10 MB or smaller.'
  return null
}

function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'certificate'
}

function decodeStoragePath(value: string): string | null {
  try {
    return value.split('/').map(segment => decodeURIComponent(segment)).join('/')
  } catch {
    return null
  }
}

/**
 * Accept the stable object path used by current records and the full Storage
 * URLs written by older clients. The returned path is always restricted to
 * this private bucket and the requested variant's folder.
 */
export function normalizeKkmCertificateStoragePath(
  storedValue: string | null | undefined,
  variantId: string,
): string | null {
  const raw = String(storedValue || '').trim()
  const expectedPrefix = `${variantId}/`
  if (!raw || !variantId || raw.includes('\\')) return null

  let candidate = raw
  let fullUrl = false
  try {
    const url = new URL(raw)
    candidate = url.pathname
    fullUrl = true
  } catch {
    candidate = raw.split(/[?#]/, 1)[0]
  }

  candidate = candidate.replace(/^\/+/, '')
  let matchedStorageUrl = false
  for (const accessType of STORAGE_OBJECT_PREFIXES) {
    const marker = `storage/v1/object/${accessType}/${KKM_CERTIFICATE_BUCKET}/`
    const markerIndex = candidate.indexOf(marker)
    if (markerIndex >= 0) {
      candidate = candidate.slice(markerIndex + marker.length)
      matchedStorageUrl = true
      break
    }
  }
  if (fullUrl && !matchedStorageUrl) return null
  if (candidate.startsWith(`${KKM_CERTIFICATE_BUCKET}/`)) {
    candidate = candidate.slice(KKM_CERTIFICATE_BUCKET.length + 1)
  }

  const decoded = decodeStoragePath(candidate)
  if (!decoded || !decoded.startsWith(expectedPrefix)) return null
  if (decoded.split('/').some(segment => !segment || segment === '.' || segment === '..')) return null
  return decoded
}

export function kkmCertificateAccessUrl(variantId: string, download = false): string {
  const base = `/api/products/variants/${encodeURIComponent(variantId)}/kkm-certificate`
  return download ? `${base}?download=1` : base
}

export async function uploadKkmCertificate(
  supabase: any,
  variantId: string,
  file: File,
  previousPath?: string | null,
) {
  const validationError = validateKkmCertificate(file)
  if (validationError) throw new Error(validationError)

  const uniquePart = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const newPath = `${variantId}/${uniquePart}-${safeFileName(file.name)}`
  const { error: uploadError } = await supabase.storage
    .from(KKM_CERTIFICATE_BUCKET)
    .upload(newPath, file, { contentType: file.type, cacheControl: '3600', upsert: false })
  if (uploadError) throw uploadError

  const { data, error: metadataError } = await supabase
    .from('variant_kkm_certificates')
    .upsert({
      product_variant_id: variantId,
      storage_path: newPath,
      file_name: file.name,
      mime_type: file.type,
      file_size: file.size,
    }, { onConflict: 'product_variant_id' })
    .select('id, product_variant_id, storage_path, file_name, mime_type, file_size, updated_at')
    .single()

  if (metadataError) {
    await supabase.storage.from(KKM_CERTIFICATE_BUCKET).remove([newPath])
    throw metadataError
  }

  if (previousPath && previousPath !== newPath) {
    const normalizedPreviousPath = normalizeKkmCertificateStoragePath(previousPath, variantId)
    const { error: cleanupError } = normalizedPreviousPath
      ? await supabase.storage.from(KKM_CERTIFICATE_BUCKET).remove([normalizedPreviousPath])
      : { error: null }
    if (cleanupError) console.error('Failed to clean up replaced KKM certificate:', cleanupError)
  }
  return data
}
