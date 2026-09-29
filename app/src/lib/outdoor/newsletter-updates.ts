export const OUTDOOR_UPDATE_KINDS = ['product', 'color', 'offer', 'shipping', 'event', 'other'] as const

export type OutdoorUpdateKind = typeof OUTDOOR_UPDATE_KINDS[number]

export const OUTDOOR_UPDATE_LABELS: Record<OutdoorUpdateKind, string> = {
  product: 'New product',
  color: 'New colour',
  offer: 'Special offer',
  shipping: 'Free shipping',
  event: 'Event',
  other: 'Update',
}

/** Kinds the first version of outdoor_admin_updates accepts; newer kinds are stored as 'other' until the migration is applied. */
export const OUTDOOR_UPDATE_LEGACY_KINDS: readonly OutdoorUpdateKind[] = ['product', 'color', 'event', 'other']

export const OUTDOOR_UPDATE_TITLE_MAX = 140
export const OUTDOOR_UPDATE_BODY_MAX = 4000
export const OUTDOOR_UPDATE_LINK_MAX = 500

export function isOutdoorUpdateKind(value: unknown): value is OutdoorUpdateKind {
  return typeof value === 'string' && (OUTDOOR_UPDATE_KINDS as readonly string[]).includes(value)
}

export function outdoorUpdateLabel(kind: string) {
  return isOutdoorUpdateKind(kind) ? OUTDOOR_UPDATE_LABELS[kind] : 'Update'
}

/** Empty means "no link"; a path like /outdoor/shop/x is joined to the site; anything else must be a full http(s) address. */
export function outdoorUpdateLink(raw: string, origin: string): { url: string; error?: undefined } | { url?: undefined; error: string } {
  const value = String(raw || '').trim()
  if (!value) return { url: '' }
  if (value.length > OUTDOOR_UPDATE_LINK_MAX || /\s/.test(value)) return { error: 'The link is not a valid web address.' }
  if (value.startsWith('/') && !value.startsWith('//')) return { url: `${origin.replace(/\/+$/, '')}${value}` }
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'The link must start with https://' }
    return { url: url.toString() }
  } catch {
    return { error: 'The link is not a valid web address.' }
  }
}
