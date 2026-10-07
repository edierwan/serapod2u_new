import {
  liveOutdoorShipping,
  outdoorBagWeightKg,
  outdoorShippingCustomerSharePercent,
  pickOutdoorShipping,
  type OutdoorShippingQuote,
  type OutdoorShippingRow,
} from '@/lib/outdoor/shipping'
import { easyParcelRateCheck, isEasyParcelConfigured } from '@/lib/shipping/easyparcel'
import { toEasyParcelState } from '@/lib/shipping/malaysia-states'

export type OutdoorShippingLine = { productId: string; quantity: number }
export type OutdoorShippingAddress = { postcode?: string | null; state?: string | null }

type ProductShippingRow = OutdoorShippingRow & { id: string }

async function loadProductShipping(supabase: any, ids: string[]): Promise<ProductShippingRow[]> {
  if (ids.length === 0) return []
  const base = 'id, outdoor_shipping_title, outdoor_shipping_note, outdoor_shipping_price'
  const first = await supabase.from('products').select(`${base}, outdoor_shipping_weight_kg`).in('id', ids)
  if (!first.error) return first.data || []
  if (/outdoor_shipping_weight_kg/i.test(first.error.message || '')) {
    const retry = await supabase.from('products').select(base).in('id', ids)
    if (!retry.error) return retry.data || []
    if (!/outdoor_shipping/i.test(retry.error.message || '')) console.error('[outdoor shipping] product settings', retry.error)
    return []
  }
  if (!/outdoor_shipping/i.test(first.error.message || '')) console.error('[outdoor shipping] product settings', first.error)
  return []
}

function liveShippingEnabled(env: NodeJS.ProcessEnv = process.env) {
  const value = String(env.OUTDOOR_LIVE_SHIPPING || '').trim().toLowerCase()
  return !['0', 'false', 'off', 'no'].includes(value)
}

/**
 * The Outdoor delivery line. With an address, and a parcel weight on every
 * product in the bag, it uses the cheapest live EasyParcel rate and charges the
 * customer their share (70% by default). Otherwise it falls back to the
 * per-product price from Master Data.
 */
export async function resolveOutdoorShipping(
  supabase: any,
  lines: OutdoorShippingLine[],
  subtotal: number,
  address?: OutdoorShippingAddress,
): Promise<OutdoorShippingQuote> {
  const ids = [...new Set(lines.map((line) => line.productId).filter(Boolean))]
  const rows = await loadProductShipping(supabase, ids)
  const fallback = pickOutdoorShipping(rows, subtotal)

  const postcode = String(address?.postcode || '').trim()
  const state = String(address?.state || '').trim()
  if (!liveShippingEnabled() || !/^\d{5}$/.test(postcode) || !state) return fallback

  const byId = new Map(rows.map((row) => [row.id, row]))
  const weightKg = outdoorBagWeightKg(
    lines
      .filter((line) => line.productId)
      .map((line) => ({ weightKg: byId.get(line.productId)?.outdoor_shipping_weight_kg, quantity: line.quantity })),
  )
  if (weightKg === null) return fallback

  try {
    if (!(await isEasyParcelConfigured())) return fallback
    const quoted = await easyParcelRateCheck({
      sendCode: postcode,
      sendState: toEasyParcelState(state),
      sendCountry: 'MY',
      weightKg,
    })
    if (!quoted.ok || quoted.rates.length === 0) {
      if (!quoted.ok) console.error('[outdoor shipping] live rate', quoted.error)
      return fallback
    }
    return liveOutdoorShipping(quoted.rates[0], subtotal, {
      customerSharePercent: outdoorShippingCustomerSharePercent(process.env.OUTDOOR_SHIPPING_CUSTOMER_SHARE_PERCENT),
    })
  } catch (err) {
    console.error('[outdoor shipping] live rate', err)
    return fallback
  }
}
