/**
 * Reference / Batch Name validation for Stock Count sessions.
 *
 * The reference is mandatory for every newly created or saved count. It is
 * validated the same way on the client (before Save / Excel / Import / Post) and
 * on the server (a DB trigger — see migration 20260730_stock_count_reference*),
 * so the rule cannot be bypassed through a direct table write or RPC. Legacy
 * rows that were saved before the rule are handled at the UI/record level, not
 * by silently generating a value.
 */

export const STOCK_COUNT_REFERENCE_MAX_LENGTH = 120

export const STOCK_COUNT_REFERENCE_REQUIRED_MESSAGE = 'Reference / Batch Name is required.'
export const STOCK_COUNT_REFERENCE_TOO_LONG_MESSAGE =
  `Reference / Batch Name must be ${STOCK_COUNT_REFERENCE_MAX_LENGTH} characters or fewer.`

/** Text shown in place of a missing reference on immutable legacy/posted records. */
export const STOCK_COUNT_REFERENCE_LEGACY_PLACEHOLDER = 'Reference not provided (legacy record)'

/** Collapse surrounding whitespace so " " never counts as a real reference. */
export function normalizeStockCountReference(value: string | null | undefined): string {
  return (value ?? '').trim()
}

export interface StockCountReferenceValidation {
  valid: boolean
  /** The trimmed value, safe to persist. */
  value: string
  message?: string
}

/**
 * Blank / whitespace-only values are invalid; oversized values are rejected.
 */
export function validateStockCountReference(value: string | null | undefined): StockCountReferenceValidation {
  const normalized = normalizeStockCountReference(value)
  if (normalized.length === 0) {
    return { valid: false, value: normalized, message: STOCK_COUNT_REFERENCE_REQUIRED_MESSAGE }
  }
  if (normalized.length > STOCK_COUNT_REFERENCE_MAX_LENGTH) {
    return { valid: false, value: normalized, message: STOCK_COUNT_REFERENCE_TOO_LONG_MESSAGE }
  }
  return { valid: true, value: normalized }
}

/** True when a saved record has no usable reference (blank / whitespace only). */
export function isStockCountReferenceMissing(value: string | null | undefined): boolean {
  return normalizeStockCountReference(value).length === 0
}
