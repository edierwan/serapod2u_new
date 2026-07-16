export const ALTERNATIVE_NAME_DUPLICATE_MESSAGE = 'This alternative name is already used by another variant.'

const COMMON_SEPARATORS = /[-‐‑‒–—―−_/]+/g

/** Normalization shared by duplicate validation and exact paste matching. */
export const normalizeAlternativeName = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .replace(COMMON_SEPARATORS, ' ')
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase()
}

/** Preserve user-facing spelling while storing blank input as NULL. */
export const cleanAlternativeName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const cleaned = value.trim().replace(/\s+/g, ' ')
  return cleaned || null
}

export const isAlternativeNameDuplicateError = (error: unknown): boolean => {
  const candidate = error as { code?: string; message?: string; details?: string } | null
  const text = `${candidate?.message || ''} ${candidate?.details || ''}`.toLowerCase()
  return candidate?.code === '23505' && (
    text.includes('product_variants_product_alternative_name_active_key')
    || text.includes('alternative name')
  )
}
