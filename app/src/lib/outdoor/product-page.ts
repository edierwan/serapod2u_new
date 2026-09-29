import { getStorageUrl } from '@/lib/utils'

export type OutdoorGalleryItem = {
  type: 'image' | 'video'
  url: string
  thumbnailUrl: string | null
  /** Variants this photo belongs to; empty for a product-wide photo. */
  variantIds: string[]
}

type GalleryVariant = {
  id: string
  image_url?: string | null
  attributes?: Record<string, unknown> | null
  media?: Array<{ type: 'image' | 'video'; url: string; thumbnail_url?: string | null }> | null
}

function customPhoto(raw: unknown) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/outdoor/')) return trimmed
  return getStorageUrl(trimmed) || trimmed
}

/**
 * Every master-data photo and video of the variants, in variant order, each listed once.
 * A variant with none of its own falls back to `fallbackFor` (product photo or packshot).
 */
export function outdoorGallery(
  variants: GalleryVariant[],
  fallbackFor: (variantId: string) => string | null | undefined,
): OutdoorGalleryItem[] {
  const items: OutdoorGalleryItem[] = []
  const byUrl = new Map<string, OutdoorGalleryItem>()
  const add = (variantId: string, type: 'image' | 'video', url: string | null | undefined, thumbnailUrl?: string | null) => {
    if (!url) return false
    const existing = byUrl.get(url)
    if (existing) {
      if (!existing.variantIds.includes(variantId)) existing.variantIds.push(variantId)
      return true
    }
    const item: OutdoorGalleryItem = { type, url, thumbnailUrl: thumbnailUrl || null, variantIds: [variantId] }
    byUrl.set(url, item)
    items.push(item)
    return true
  }

  for (const variant of variants) {
    let found = add(variant.id, 'image', customPhoto(variant.attributes?.outdoor_image))
    for (const media of variant.media || []) {
      found = add(variant.id, media.type === 'video' ? 'video' : 'image', media.url, media.thumbnail_url) || found
    }
    found = add(variant.id, 'image', variant.image_url) || found
    if (!found) add(variant.id, 'image', fallbackFor(variant.id))
  }
  return items
}

const HIDDEN_SPEC_KEYS = new Set(['colour_hex', 'color_hex', 'hex'])

function specLabel(key: string) {
  const words = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Customer-facing rows from a variant's master-data attributes; internal settings stay hidden. */
export function outdoorSpecRows(attributes: Record<string, unknown> | null | undefined) {
  const rows: Array<{ label: string; value: string }> = []
  for (const [key, raw] of Object.entries(attributes || {})) {
    const normalized = key.trim().toLowerCase().replace(/\s+/g, '_')
    if (!normalized || normalized.startsWith('outdoor_') || HIDDEN_SPEC_KEYS.has(normalized)) continue
    if (typeof raw !== 'string' && typeof raw !== 'number') continue
    const value = String(raw).trim()
    if (!value) continue
    rows.push({ label: specLabel(key), value })
  }
  return rows
}
