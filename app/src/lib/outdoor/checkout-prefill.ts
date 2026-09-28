import { MALAYSIA_STATES } from '@/lib/shipping/malaysia-states'

export type OutdoorCheckoutPrefill = {
  name: string
  phone: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postcode: string
}

function text(raw: unknown) {
  return typeof raw === 'string' ? raw.trim() : ''
}

function first(...values: unknown[]) {
  for (const value of values) {
    const clean = text(value)
    if (clean) return clean
  }
  return ''
}

function stateLabel(raw: unknown) {
  const clean = text(raw).toLowerCase()
  if (!clean) return ''
  const match = MALAYSIA_STATES.find(
    (state) => state.label.toLowerCase() === clean || state.code === clean || state.iso.toLowerCase() === clean,
  )
  return match?.label || ''
}

/**
 * Fills only what we already know: the account profile, Google / X sign-in details,
 * and the shopper's last order. Anything unknown stays empty.
 */
export function outdoorCheckoutPrefill(input: {
  metadata?: Record<string, unknown> | null
  authPhone?: string | null
  profile?: { full_name?: string | null; phone?: string | null; address?: string | null } | null
  lastOrder?: {
    customer_name?: string | null
    customer_phone?: string | null
    shipping_address?: Record<string, unknown> | null
  } | null
}): OutdoorCheckoutPrefill {
  const meta = input.metadata || {}
  const address = input.lastOrder?.shipping_address || {}
  const hasOrderAddress = Boolean(text(address.line1))

  return {
    name: first(
      input.profile?.full_name,
      meta.full_name,
      meta.name,
      meta.display_name,
      input.lastOrder?.customer_name,
    ),
    phone: first(meta.outdoor_phone, input.profile?.phone, input.lastOrder?.customer_phone, meta.phone, input.authPhone),
    addressLine1: hasOrderAddress ? text(address.line1) : text(input.profile?.address),
    addressLine2: hasOrderAddress ? text(address.line2) : '',
    city: first(hasOrderAddress ? address.city : '', meta.outdoor_location),
    state: hasOrderAddress ? stateLabel(address.state) : '',
    postcode: hasOrderAddress ? text(address.postcode) : '',
  }
}
