import { normalizePersistedOrganizationLogo, resolveOrganizationLogoUrl } from '@/lib/organizations/logo'
import { getStorageUrl } from '@/lib/utils'

export interface PdfAuditActor {
  full_name: string
  signature_url: string | null
}

/**
 * Resolve the exact organizations.logo_url value used by Organization
 * Information into a server-fetchable storage URL for PDF generation.
 */
export function resolvePdfOrganizationLogoSource(value: unknown): string | null {
  const persistedLogo = normalizePersistedOrganizationLogo(value)
  if (!persistedLogo) return null

  return resolveOrganizationLogoUrl(persistedLogo) || null
}

/** Resolve user signature paths through the same shared storage URL helper. */
export function resolvePdfImageSource(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return getStorageUrl(value.trim(), 'avatars') || null
}

/**
 * Keep an audit label and signature paired to one authoritative users row.
 * Role labels are deliberately not accepted as a person's display name.
 */
export function resolvePdfAuditActor(value: unknown): PdfAuditActor | null {
  if (!value || typeof value !== 'object') return null

  const row = value as Record<string, unknown>
  const fullName = typeof row.full_name === 'string' ? row.full_name.trim() : ''
  if (!fullName) return null

  return {
    full_name: fullName,
    signature_url: typeof row.signature_url === 'string' && row.signature_url.trim()
      ? row.signature_url.trim()
      : null
  }
}
