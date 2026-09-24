export type OutdoorColorSwatch = {
  hex: string
  label: string
  imageUrl: string | null
}

const COLOR_RULES: Array<{ test: RegExp; hex: string; label: string; file: 'burgundy' | 'pink' | 'grey' }> = [
  { test: /burgundy|wine|maroon/i, hex: '#76232F', label: 'Burgundy Sand', file: 'burgundy' },
  { test: /matcha|olive|green|pink|blush/i, hex: '#5E6738', label: 'Matcha Berry', file: 'pink' },
  { test: /grey|gray|silver/i, hex: '#7C878E', label: 'Orange Grey', file: 'grey' },
]

export const OUTDOOR_COLOURWAYS: Array<{ hex: string; label: string; file: 'burgundy' | 'pink' | 'grey' }> = [
  { hex: '#76232F', label: 'Burgundy Sand', file: 'burgundy' },
  { hex: '#5E6738', label: 'Matcha Berry', file: 'pink' },
  { hex: '#7C878E', label: 'Orange Grey', file: 'grey' },
]

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
    variant_name?: string | null
    image_url?: string | null
    attributes?: Record<string, unknown> | null
  }>,
  productName?: string,
): OutdoorColorSwatch[] {
  const out: OutdoorColorSwatch[] = []
  const seen = new Set<string>()
  for (const variant of variants) {
    const attrs = asRecord(variant.attributes)
    if (attrs.outdoor_hidden) continue
    const attrColor = String(attrs.color || attrs.colour || attrs.hex || attrs.Color || '')
    const found = outdoorColorFromText(attrColor) || outdoorColorFromText(String(variant.variant_name || ''))
    const custom = String(attrs.outdoor_image || '').trim()
    if (!found) {
      if (!custom || seen.has(custom)) continue
      seen.add(custom)
      out.push({ hex: '#C1C6C8', label: 'Photo', imageUrl: custom })
      continue
    }
    const key = found.hex.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const kindName = productName || String(variant.variant_name || '')
    out.push({
      hex: found.hex,
      label: found.label,
      imageUrl: custom || outdoorStaticImage(kindName, found.hex) || variant.image_url || null,
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
