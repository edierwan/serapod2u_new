import { getStorageUrl } from '@/lib/utils'

export type OutdoorColorSwatch = {
  hex: string
  label: string
  imageUrl: string | null
  price?: number | null
  isDefault?: boolean
  variantId?: string
}

const COLOR_RULES: Array<{ test: RegExp; hex: string; label: string; file: 'burgundy' | 'pink' | 'grey' }> = [
  { test: /burgundy|wine|maroon/i, hex: '#76232F', label: 'Burgundy Sand', file: 'burgundy' },
  { test: /matcha|olive|green|pink|blush/i, hex: '#5E6738', label: 'Matcha Berry', file: 'pink' },
  { test: /grey|gray|silver/i, hex: '#7C878E', label: 'Orange Grey', file: 'grey' },
  { test: /\bblue\b/i, hex: '#1B4F8A', label: 'Blue', file: 'burgundy' },
  { test: /\bred\b/i, hex: '#B42318', label: 'Red', file: 'burgundy' },
]

export const OUTDOOR_NAV = [
  { key: 'new', label: 'New in' },
  { key: 'chair', label: 'Moon Chair' },
  { key: 'tumbler', label: 'Tumbler' },
  { key: 'mat', label: 'Camp Mat' },
] as const

export type OutdoorNavKey = (typeof OUTDOOR_NAV)[number]['key']

export function outdoorNavFromName(name: string): OutdoorNavKey | '' {
  const n = String(name || '').toLowerCase()
  if (n.includes('tumbler')) return 'tumbler'
  if (n.includes('mat') || n.includes('mattress') || n.includes('pad')) return 'mat'
  if (n.includes('chair') || n.includes('moon')) return 'chair'
  return ''
}

export function outdoorNavKey(saved: string, name = ''): OutdoorNavKey | '' {
  const key = String(saved || '').trim()
  if (OUTDOOR_NAV.some((item) => item.key === key)) return key as OutdoorNavKey
  return outdoorNavFromName(name)
}

export const OUTDOOR_COLOURWAYS: Array<{ hex: string; label: string; file: 'burgundy' | 'pink' | 'grey' }> = [
  { hex: '#76232F', label: 'Burgundy Sand', file: 'burgundy' },
  { hex: '#5E6738', label: 'Matcha Berry', file: 'pink' },
  { hex: '#7C878E', label: 'Orange Grey', file: 'grey' },
]

function hexFromName(name: string) {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0
  const hue = hash % 360
  const channel = (offset: number) => {
    const value = Math.cos((hue + offset) * Math.PI / 180)
    return Math.round((0.55 + 0.35 * value) * 255).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(120)}${channel(240)}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function outdoorProductKind(name: string): 'chair' | 'tumbler' | 'mat' | null {
  const n = String(name || '').toLowerCase()
  if (n.includes('tumbler')) return 'tumbler'
  if (n.includes('mat') || n.includes('mattress') || n.includes('pad')) return 'mat'
  if (n.includes('chair') || n.includes('moon')) return 'chair'
  return null
}

export function outdoorStaticImage(productName: string, hexOrFile: string): string | null {
  const kind = outdoorProductKind(productName)
  if (!kind) return null
  const raw = hexOrFile.toLowerCase()
  const file =
    raw === 'burgundy' || raw === '#76232f'
      ? 'burgundy'
      : raw === 'grey' || raw === '#7c878e' || raw === '#c1c6c8'
        ? 'grey'
        : 'pink'
  return `/outdoor/products/${kind}-${file}.png`
}

export function outdoorFallbackSwatches(productName: string): OutdoorColorSwatch[] {
  return OUTDOOR_COLOURWAYS.map((way) => ({
    hex: way.hex,
    label: way.label,
    imageUrl: outdoorStaticImage(productName, way.file),
  }))
}

export function outdoorColorFromText(text: string): { hex: string; label: string } | null {
  const raw = String(text || '').trim()
  if (!raw) return null
  const hexMatch = raw.match(/#([0-9a-f]{6})/i)
  if (hexMatch) return { hex: `#${hexMatch[1].toUpperCase()}`, label: raw }
  for (const rule of COLOR_RULES) {
    if (rule.test.test(raw)) return { hex: rule.hex, label: rule.label }
  }
  return null
}

export function outdoorSwatchesFromVariants(
  variants: Array<{
    id?: string | null
    variant_name?: string | null
    image_url?: string | null
    attributes?: Record<string, unknown> | null
    price?: number | null
    is_default?: boolean | null
  }>,
  productName?: string,
): OutdoorColorSwatch[] {
  const out: OutdoorColorSwatch[] = []
  const seen = new Set<string>()
  const ordered = [...variants].sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)))
  for (const variant of ordered) {
    const attrs = asRecord(variant.attributes)
    if (attrs.outdoor_hidden) continue
    const attrColor = String(attrs.color || attrs.colour || attrs.hex || attrs.Color || '')
    const found = outdoorColorFromText(attrColor) || outdoorColorFromText(String(variant.variant_name || ''))
    const custom = String(attrs.outdoor_image || '').trim()
    const photo = (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) return ''
      if (trimmed.startsWith('/outdoor/')) return trimmed
      return getStorageUrl(trimmed) || trimmed
    }
    const amount = Number(variant.price)
    const price = Number.isFinite(amount) && amount > 0 ? amount : null
    if (!found) {
      // Chair, mat, and tumbler keep their ready-made photos.
      // A variant name that is not a colour must not replace those photos.
      if (outdoorProductKind(productName || '')) continue
      const label = String(variant.variant_name || '').trim() || 'Variant'
      const imageUrl = photo(custom) || photo(String(variant.image_url || '')) || null
      const key = variant.id || label.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        hex: hexFromName(label),
        label,
        imageUrl,
        price,
        isDefault: Boolean(variant.is_default),
        variantId: variant.id || undefined,
      })
      continue
    }
    const key = found.hex.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const kindName = productName || String(variant.variant_name || '')
    const imageUrl = photo(custom) || outdoorStaticImage(kindName, found.hex) || photo(String(variant.image_url || '')) || null
    out.push({
      hex: found.hex,
      label: found.label,
      imageUrl,
      price,
      isDefault: Boolean(variant.is_default),
      variantId: variant.id || undefined,
    })
  }
  return out
}

export function outdoorSpecLabel(
  productName: string,
  variantName?: string | null,
  attrs?: Record<string, unknown> | null,
): string | null {
  const fromAttr = String(asRecord(attrs).capacity || asRecord(attrs).size || asRecord(attrs).spec || asRecord(attrs).volume || '').trim()
  if (fromAttr) return fromAttr

  const text = `${productName} ${variantName || ''}`
  const ml = text.match(/(\d+(?:\.\d+)?)\s*(ml)\b/i)
  if (ml) return `${ml[1]}ml`
  const liters = text.match(/(\d+(?:\.\d+)?)\s*l\b/i)
  if (liters) {
    const n = Number(liters[1])
    if (Number.isFinite(n) && n > 0 && n <= 10) return `${Math.round(n * 1000)}ml`
  }
  if (/\b1\.2\b/.test(text)) return '1200ml'
  if (/\blow\b/i.test(text)) return 'Low'
  if (/\bhigh\b/i.test(text)) return 'High'
  return null
}
