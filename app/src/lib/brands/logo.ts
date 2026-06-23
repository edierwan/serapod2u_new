import { getStorageUrl } from '@/lib/utils'

const TEMPORARY_BROWSER_URL = /^(blob:|data:)/i

/** Values safe to persist in brands.logo_url. */
export function normalizePersistedBrandLogo(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim()
  if (!normalized || TEMPORARY_BROWSER_URL.test(normalized)) return null

  return normalized
}

/** Resolve legacy URLs, public URLs, relative storage URLs, and object paths. */
export function resolveBrandLogoUrl(value: unknown): string {
  const persistedLogo = normalizePersistedBrandLogo(value)
  return persistedLogo ? getStorageUrl(persistedLogo, 'product-images') : ''
}

export function persistedBrandLogoMatches(value: unknown, expected: string | null): boolean {
  return normalizePersistedBrandLogo(value) === normalizePersistedBrandLogo(expected)
}
