export const PRODUCT_CODE_MAX_LENGTH = 5

export const PRODUCT_CODE_DUPLICATE_MESSAGE =
  'This Product Code is already used by another variant under this brand.'

export function normalizeProductCode(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toUpperCase()
  return normalized || null
}

export function validateProductCode(value: unknown): string | null {
  const normalized = normalizeProductCode(value)
  if (normalized && normalized.length > PRODUCT_CODE_MAX_LENGTH) {
    return `Product Code must be ${PRODUCT_CODE_MAX_LENGTH} characters or fewer.`
  }

  return null
}

export function isProductCodeDuplicateError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const candidate = error as { message?: unknown; details?: unknown; constraint?: unknown }
  const text = [candidate.message, candidate.details, candidate.constraint]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')

  return (
    text.includes(PRODUCT_CODE_DUPLICATE_MESSAGE) ||
    text.includes('product_variants_brand_product_code_key')
  )
}
