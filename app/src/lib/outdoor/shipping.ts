/** What the Outdoor customer pays. Set to 0 to show Free shipping. */
export const OUTDOOR_FLAT_SHIPPING_RM = 2

/** Orders at or above this subtotal ship free. null keeps the flat rate. */
export const OUTDOOR_FREE_SHIPPING_OVER_RM: number | null = null

export function outdoorCustomerShippingAmount(
  subtotal: number,
  options?: { flat?: number; freeOver?: number | null },
) {
  const flat = options?.flat ?? OUTDOOR_FLAT_SHIPPING_RM
  const freeOver = options && 'freeOver' in options ? options.freeOver : OUTDOOR_FREE_SHIPPING_OVER_RM
  const goods = Number(subtotal)
  if (freeOver != null && freeOver > 0 && Number.isFinite(goods) && goods >= freeOver) return 0
  if (!Number.isFinite(flat) || flat <= 0) return 0
  return Math.round(flat * 100) / 100
}
