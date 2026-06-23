import { extractStoragePath, getStorageUrl } from '@/lib/utils'

const TEMPORARY_BROWSER_URL = /^(blob:|data:)/i

export function normalizePersistedOrganizationLogo(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized || TEMPORARY_BROWSER_URL.test(normalized)) return null

  return normalized
}

export function resolveOrganizationLogoUrl(value: unknown): string {
  const persistedLogo = normalizePersistedOrganizationLogo(value)
  return persistedLogo ? getStorageUrl(persistedLogo, 'avatars') : ''
}

export function getOwnedOrganizationLogoPath(value: unknown, organizationId: string): string | null {
  const persistedLogo = normalizePersistedOrganizationLogo(value)
  if (!persistedLogo || !organizationId) return null

  const objectPath = extractStoragePath(persistedLogo)
  if (!objectPath || objectPath.includes('..')) return null

  return objectPath.startsWith(`${organizationId}/`) ? objectPath : null
}

export function persistedOrganizationLogoMatches(value: unknown, expected: string | null): boolean {
  return normalizePersistedOrganizationLogo(value) === normalizePersistedOrganizationLogo(expected)
}
