/** What the Outdoor customer pays when the product has no delivery price of its own. */
export const OUTDOOR_FLAT_SHIPPING_RM = 2

/** Orders at or above this subtotal ship free. null keeps the product rates. */
export const OUTDOOR_FREE_SHIPPING_OVER_RM: number | null = null

export const OUTDOOR_SHIPPING_TITLE = 'Standard delivery'
export const OUTDOOR_SHIPPING_NOTE = 'One rate for every address in Malaysia. We arrange the courier.'
export const OUTDOOR_FREE_SHIPPING_TITLE = 'Free shipping'
export const OUTDOOR_FREE_SHIPPING_NOTE = 'We cover delivery anywhere in Malaysia.'

export type OutdoorShippingRow = {
  outdoor_shipping_title?: string | null
  outdoor_shipping_note?: string | null
  outdoor_shipping_price?: number | string | null
  outdoor_shipping_weight_kg?: number | string | null
}

export type OutdoorShippingQuote = {
  amount: number
  title: string
  note: string
  /** Set when the amount comes from a live EasyParcel rate: what the courier charges us. */
  actualCost?: number
  /** Part of actualCost the company pays. */
  subsidy?: number
  courier?: { serviceId: string; courierName: string; serviceName: string }
}

/** Share of the live EasyParcel rate the Outdoor customer pays. The company covers the rest. */
export const OUTDOOR_SHIPPING_CUSTOMER_SHARE_PERCENT = 70

export function outdoorShippingCustomerSharePercent(raw: unknown = OUTDOOR_SHIPPING_CUSTOMER_SHARE_PERCENT) {
  const value = Number(raw)
  if (raw === null || raw === undefined || String(raw).trim() === '' || !Number.isFinite(value)) {
    return OUTDOOR_SHIPPING_CUSTOMER_SHARE_PERCENT
  }
  return Math.min(100, Math.max(0, value))
}

export function outdoorParcelWeightKg(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 1000) / 1000
}

/** Total parcel weight, or null when any product in the bag has no parcel weight yet. */
export function outdoorBagWeightKg(lines: Array<{ weightKg: unknown; quantity: number }>): number | null {
  if (lines.length === 0) return null
  let total = 0
  for (const line of lines) {
    const weight = outdoorParcelWeightKg(line.weightKg)
    const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0))
    if (weight === null) return null
    total += weight * quantity
  }
  return total > 0 ? Math.round(total * 1000) / 1000 : null
}

function roundRm(value: number) {
  return Math.round(value * 100) / 100
}

/**
 * Delivery line from a live EasyParcel rate: the customer pays their share,
 * the company absorbs the rest. Free-shipping threshold still applies.
 */
export function liveOutdoorShipping(
  rate: { serviceId: string; courierName: string; serviceName: string; price: number },
  subtotal: number,
  options?: { customerSharePercent?: number; freeOver?: number | null },
): OutdoorShippingQuote {
  const actualCost = roundRm(Math.max(0, Number(rate.price) || 0))
  const share = outdoorShippingCustomerSharePercent(options?.customerSharePercent)
  const freeOver = options && 'freeOver' in options ? options.freeOver : OUTDOOR_FREE_SHIPPING_OVER_RM
  const goods = Number(subtotal)
  const free = freeOver != null && freeOver > 0 && Number.isFinite(goods) && goods >= freeOver
  const amount = free ? 0 : roundRm((actualCost * share) / 100)
  const subsidy = roundRm(actualCost - amount)
  const courier = { serviceId: rate.serviceId, courierName: rate.courierName, serviceName: rate.serviceName }
  if (amount <= 0) {
    return { amount: 0, title: OUTDOOR_FREE_SHIPPING_TITLE, note: OUTDOOR_FREE_SHIPPING_NOTE, actualCost, subsidy, courier }
  }
  return {
    amount,
    title: rate.courierName ? `${rate.courierName} delivery` : OUTDOOR_SHIPPING_TITLE,
    note: subsidy > 0
      ? `Courier rate RM ${actualCost.toFixed(2)}. We cover RM ${subsidy.toFixed(2)} of it for you.`
      : `Courier rate for your address.`,
    actualCost,
    subsidy,
    courier,
  }
}

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

export function outdoorShippingPrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100) / 100
}

function text(raw: unknown) {
  return typeof raw === 'string' ? raw.trim() : ''
}

/**
 * One delivery line for the whole bag.
 * Each product may set its own title, note, and price in Master Data.
 * When the bag mixes products, the highest delivery price wins.
 */
export function pickOutdoorShipping(
  rows: OutdoorShippingRow[],
  subtotal: number,
  options?: { freeOver?: number | null },
): OutdoorShippingQuote {
  let chosen: { price: number; title: string; note: string } | null = null
  for (const row of rows.length > 0 ? rows : [{}]) {
    const price = outdoorShippingPrice(row.outdoor_shipping_price) ?? OUTDOOR_FLAT_SHIPPING_RM
    if (chosen && price <= chosen.price) continue
    chosen = { price, title: text(row.outdoor_shipping_title), note: text(row.outdoor_shipping_note) }
  }

  const amount = outdoorCustomerShippingAmount(subtotal, {
    flat: chosen?.price ?? OUTDOOR_FLAT_SHIPPING_RM,
    freeOver: options && 'freeOver' in options ? options.freeOver : OUTDOOR_FREE_SHIPPING_OVER_RM,
  })
  const free = amount <= 0
  const customPriceFree = (chosen?.price ?? OUTDOOR_FLAT_SHIPPING_RM) <= 0
  const useCustomText = !free || customPriceFree
  return {
    amount,
    title: (useCustomText && chosen?.title) || (free ? OUTDOOR_FREE_SHIPPING_TITLE : OUTDOOR_SHIPPING_TITLE),
    note: (useCustomText && chosen?.note) || (free ? OUTDOOR_FREE_SHIPPING_NOTE : OUTDOOR_SHIPPING_NOTE),
  }
}
