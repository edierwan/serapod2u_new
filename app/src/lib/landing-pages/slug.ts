const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'cart',
  'checkout',
  'dashboard',
  'login',
  'orders',
  'products',
  'store',
  'support',
])

export function normalizeLandingPageSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

export function isValidLandingPageSlug(value: string): boolean {
  return SLUG_PATTERN.test(value) && value.length >= 3 && value.length <= 80 && !RESERVED_SLUGS.has(value)
}

export function getLandingPageSlugError(value: string): string | null {
  if (!value) return 'Slug is required.'
  if (RESERVED_SLUGS.has(value)) return 'Slug is reserved.'
  if (value.length < 3 || value.length > 80) return 'Slug must be between 3 and 80 characters.'
  if (!SLUG_PATTERN.test(value)) return 'Slug can contain lowercase letters, numbers, and single hyphens only.'
  return null
}