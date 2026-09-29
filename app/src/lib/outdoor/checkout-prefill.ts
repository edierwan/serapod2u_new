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

const STATE_ALIASES: Array<[RegExp, string]> = [
  [/\bpulau\s+pinang\b|\bp\.?\s*pinang\b/i, 'Penang'],
  [/\bmalacca\b/i, 'Melaka'],
  [/\bn\.?\s*sembilan\b/i, 'Negeri Sembilan'],
]

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stateInText(raw: string) {
  for (const state of MALAYSIA_STATES) {
    if (new RegExp(`\\b${escapeRegExp(state.label)}\\b`, 'i').test(raw)) return state.label
  }
  for (const [pattern, label] of STATE_ALIASES) {
    if (pattern.test(raw)) return label
  }
  return ''
}

/** The profile keeps one free-text address; split it into the checkout fields without guessing the city. */
export function splitProfileAddress(raw: unknown) {
  const lines = text(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const joined = lines.join(' ')
  return {
    line1: lines[0] || '',
    line2: lines.slice(1).join(', '),
    postcode: joined.match(/\b\d{5}\b/)?.[0] || '',
    state: stateInText(joined),
  }
}

/**
 * Fills only what we already know: the account profile, Google / X sign-in details,
 * and the shopper's last order. Anything unknown stays empty.
 * The profile address wins; the last order's address is used only when the profile has none,
 * and the two are never mixed.
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
  const profileAddress = splitProfileAddress(input.profile?.address)

  const delivery = profileAddress.line1
    ? {
        addressLine1: profileAddress.line1,
        addressLine2: profileAddress.line2,
        city: text(meta.outdoor_location),
        state: profileAddress.state,
        postcode: profileAddress.postcode,
      }
    : {
        addressLine1: hasOrderAddress ? text(address.line1) : '',
        addressLine2: hasOrderAddress ? text(address.line2) : '',
        city: first(hasOrderAddress ? address.city : '', meta.outdoor_location),
        state: hasOrderAddress ? stateLabel(address.state) : '',
        postcode: hasOrderAddress ? text(address.postcode) : '',
      }

  return {
    name: first(
      input.profile?.full_name,
      meta.full_name,
      meta.name,
      meta.display_name,
      input.lastOrder?.customer_name,
    ),
    phone: first(meta.outdoor_phone, input.profile?.phone, input.lastOrder?.customer_phone, meta.phone, input.authPhone),
    ...delivery,
  }
}
