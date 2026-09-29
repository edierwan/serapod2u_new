export interface RgbColour {
  red: number
  green: number
  blue: number
}

export interface LabColour {
  lightness: number
  a: number
  b: number
}

export interface ColourReference extends RgbColour {
  colour_name: string
  hex_code: string
}

const FALLBACK_VALUES: Array<[string, string]> = [
  ['Black', '#000000'], ['White', '#FFFFFF'], ['Grey', '#808080'], ['Silver', '#C0C0C0'],
  ['Red', '#FF0000'], ['Maroon', '#800000'], ['Orange', '#FFA500'], ['Yellow', '#FFFF00'],
  ['Olive', '#808000'], ['Green', '#008000'], ['Lime', '#00FF00'], ['Teal', '#008080'],
  ['Cyan', '#00FFFF'], ['Blue', '#0000FF'], ['Navy', '#000080'], ['Purple', '#800080'],
  ['Magenta', '#FF00FF'], ['Pink', '#FFC0CB'], ['Brown', '#A52A2A'], ['Beige', '#F5F5DC'],
  ['Gold', '#FFD700'], ['Royal Blue', '#4169E1'], ['Steel Blue', '#4682B4'],
  ['Cornflower Blue', '#6495ED'], ['Dodger Blue', '#1E90FF'], ['Midnight Blue', '#191970'],
  ['Dark Slate Blue', '#483D8B'], ['Slate Blue', '#6A5ACD'], ['Sky Blue', '#87CEEB'],
  ['Light Blue', '#ADD8E6'], ['Dark Red', '#8B0000'], ['Dark Green', '#006400'],
  ['Dark Orange', '#FF8C00'], ['Dark Violet', '#9400D3'], ['Indigo', '#4B0082'],
  ['Violet', '#EE82EE'], ['Coral', '#FF7F50'], ['Salmon', '#FA8072'],
  ['Khaki', '#F0E68C'], ['Chocolate', '#D2691E'], ['Tan', '#D2B48C'],
]

export const FALLBACK_COLOUR_REFERENCE: ColourReference[] = FALLBACK_VALUES.map(([colour_name, hex_code]) => ({
  colour_name,
  hex_code,
  ...hexToRgb(hex_code)!,
}))

let cachedPalette: ColourReference[] | null = null

export function normalizeColourHex(value: string) {
  const normalized = value.trim().toUpperCase()
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null
}

export function hexToRgb(value: string): RgbColour | null {
  const hex = normalizeColourHex(value)
  if (!hex) return null
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  }
}

export function rgbToHex(rgb: RgbColour) {
  const channels = [rgb.red, rgb.green, rgb.blue]
  if (channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) return null
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

export function rgbToLab(rgb: RgbColour): LabColour {
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const red = linear(rgb.red)
  const green = linear(rgb.green)
  const blue = linear(rgb.blue)
  const x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047
  const y = (red * 0.2126 + green * 0.7152 + blue * 0.0722)
  const z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883
  const pivot = (value: number) => value > 0.008856 ? Math.cbrt(value) : (7.787 * value) + (16 / 116)
  const fx = pivot(x)
  const fy = pivot(y)
  const fz = pivot(z)
  return {
    lightness: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

export function deltaE76(first: LabColour, second: LabColour) {
  return Math.sqrt(
    ((first.lightness - second.lightness) ** 2) +
    ((first.a - second.a) ** 2) +
    ((first.b - second.b) ** 2),
  )
}

export function nearestColour(rgb: RgbColour, palette: ColourReference[] = FALLBACK_COLOUR_REFERENCE) {
  if (palette.length === 0) return null
  const target = rgbToLab(rgb)
  return palette.reduce<{ colour: ColourReference; distance: number } | null>((nearest, colour) => {
    const distance = deltaE76(target, rgbToLab(colour))
    return !nearest || distance < nearest.distance ? { colour, distance } : nearest
  }, null)?.colour || null
}

export async function loadColourReferencePalette(client: any): Promise<ColourReference[]> {
  if (cachedPalette) return cachedPalette
  if (!client) return FALLBACK_COLOUR_REFERENCE
  try {
    const { data, error } = await client
      .from('product_colour_reference')
      .select('colour_name, hex_code, red, green, blue')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('colour_name', { ascending: true })
    if (error || !data?.length) {
      cachedPalette = FALLBACK_COLOUR_REFERENCE
      return cachedPalette
    }
    const loadedPalette = data
      .map((row: ColourReference) => ({ ...row, hex_code: normalizeColourHex(row.hex_code) || row.hex_code }))
      .filter((row: ColourReference) => Boolean(normalizeColourHex(row.hex_code)))
    const resolvedPalette: ColourReference[] = loadedPalette.length > 0 ? loadedPalette : FALLBACK_COLOUR_REFERENCE
    cachedPalette = resolvedPalette
    return resolvedPalette
  } catch {
    cachedPalette = FALLBACK_COLOUR_REFERENCE
    return FALLBACK_COLOUR_REFERENCE
  }
}

export function resetColourReferenceCacheForTests() {
  cachedPalette = null
}
