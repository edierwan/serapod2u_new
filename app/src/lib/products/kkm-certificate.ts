export const KKM_CERTIFICATE_BUCKET = 'kkm-certificates'
export const KKM_CERTIFICATE_MAX_FILE_SIZE = 10 * 1024 * 1024

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
    const { error: cleanupError } = await supabase.storage.from(KKM_CERTIFICATE_BUCKET).remove([previousPath])
    if (cleanupError) console.error('Failed to clean up replaced KKM certificate:', cleanupError)
  }
  return data
}
