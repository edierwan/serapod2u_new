/**
 * Lowest amount the card gateway accepts for one payment (Stripe: RM 2.00 for MYR).
 * A retail price of 0 or empty means "not sold online"; anything between 0 and this
 * amount can never be paid for, so master data rejects it.
 */
export const MIN_RETAIL_PRICE = 2
export const MIN_ORDER_TOTAL = 2

export function retailPriceError(value: number | null | undefined): string | null {
  if (value == null || value === 0) return null
  if (!Number.isFinite(value) || value < 0) return 'Retail price must be a positive amount.'
  if (value < MIN_RETAIL_PRICE) {
    return `Retail price must be at least RM ${MIN_RETAIL_PRICE.toFixed(2)}, or left empty if it is not sold online.`
  }
  return null
}

export function isSellablePrice(value: unknown) {
  const price = Number(value)
  return Number.isFinite(price) && price >= MIN_RETAIL_PRICE
}

/** Customer-safe text for a payment gateway failure. The raw gateway error is only logged. */
export function customerPaymentError(raw: string | null | undefined) {
  const text = String(raw || '')
  if (/amount_too_small|amount too small|at least/i.test(text)) {
    return `The order total must be at least RM ${MIN_ORDER_TOTAL.toFixed(2)} to pay online.`
  }
  return 'We could not open the payment page. Please try again in a moment.'
}
