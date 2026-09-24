import { createAdminClient } from '@/lib/supabase/admin'
import { outdoorNavKey, outdoorSpecLabel, outdoorSwatchesFromVariants, type OutdoorColorSwatch } from '@/lib/outdoor/merch'
import { formatStorefrontError } from '@/lib/storefront/error'
import { getStorageUrl } from '@/lib/utils'

/**
 * Resolve a variant image/media URL to a full public URL.
 * Uses the shared storage helper so stale Supabase hosts are rewritten and
 * self-hosted storage URLs include the required anon apikey.
 */
function toStorefrontMediaUrl(rawPath: string | null): string | null {
  const normalizedPath = rawPath?.trim()
  if (!normalizedPath) return null
  return getStorageUrl(normalizedPath) || normalizedPath
}

/** @deprecated Use toStorefrontMediaUrl instead */
const toStorefrontImageUrl = toStorefrontMediaUrl

// ── Types ────────────────────────────────────────────────────────

export interface StorefrontProduct {
  id: string
  product_name: string
  product_code: string
  product_description: string | null
  short_description: string | null
  is_active: boolean | null
  category_id: string
  brand_id: string | null
  category_name?: string
  brand_name?: string
  image_url: string | null
  animation_url: string | null
  /** 'image' | 'video' | 'animation' — resolved from available media */
  media_type: 'image' | 'video' | 'animation'
  starting_price: number | null
  variant_count: number
  tags: string[]
  colorSwatches?: OutdoorColorSwatch[]
  specLabel?: string | null
  outdoorNav?: string
}

export interface StorefrontProductDetail {
  id: string
  product_name: string
  product_code: string
  product_description: string | null
  short_description: string | null
  is_active: boolean | null
  category_name: string | null
  brand_name: string | null
  variants: StorefrontVariant[]
}

export interface StorefrontMediaItem {
  id: string
  type: 'image' | 'video'
  url: string
  thumbnail_url: string | null
  sort_order: number
  is_default: boolean
}

export interface StorefrontVariant {
  id: string
  variant_name: string
  variant_code: string
  image_url: string | null
  animation_url: string | null
  suggested_retail_price: number | null
  base_cost: number | null
  is_active: boolean | null
  is_default: boolean | null
  attributes: Record<string, unknown> | null
  barcode: string | null
  sort_order: number | null
  media: StorefrontMediaItem[]
}

export interface StorefrontCategory {
  id: string
  name: string
  image_url: string | null
  product_count: number
}

interface ListProductsParams {
  search?: string
  category?: string
  /** Optional brand UUID — used by Outdoor when OUTDOOR_BRAND_ID is set. */
  brandId?: string
  /** Outdoor listings include products created from the Outdoor admin desk. */
  channel?: 'store' | 'outdoor'
  /** Outdoor admin products, even when they have no catalogue group. */
  outdoorOnly?: boolean
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'name_asc'
  page?: number
  limit?: number
}

interface ProductImageCandidate {
  image_url?: string | null
  is_active?: boolean | null
  is_primary?: boolean | null
  sort_order?: number | null
}

interface VariantMediaCandidate {
  type?: string | null
  url?: string | null
  is_default?: boolean | null
  sort_order?: number | null
}

interface ProductVariantCandidate {
  image_url?: string | null
  animation_url?: string | null
  is_active?: boolean | null
  is_default?: boolean | null
  sort_order?: number | null
  variant_media?: VariantMediaCandidate[] | null
}

function hasMediaValue(value: string | null | undefined): value is string {
  return Boolean(value?.trim())
}

function byPreferredOrder<T extends { is_default?: boolean | null; sort_order?: number | null }>(a: T, b: T) {
  const defaultDifference = Number(Boolean(b.is_default)) - Number(Boolean(a.is_default))
  return defaultDifference || (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
}

/**
 * Pick storefront card media without assuming every environment stores product
 * uploads in the same table. New product-level images take precedence; variant
 * fields and variant_media remain fallbacks for legacy and migrated records.
 */
export function selectStorefrontProductMedia(
  productImages: ProductImageCandidate[] | null | undefined,
  variants: ProductVariantCandidate[] | null | undefined
) {
  const orderedProductImages = [...(productImages || [])]
    .filter((image) => image.is_active !== false && hasMediaValue(image.image_url))
    .sort((a, b) => {
      const primaryDifference = Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary))
      return primaryDifference || (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
    })

  const orderedVariants = [...(variants || [])]
    .filter((variant) => variant.is_active !== false)
    .sort(byPreferredOrder)

  const variantImage = orderedVariants.find((variant) => hasMediaValue(variant.image_url))?.image_url
  const variantAnimation = orderedVariants.find((variant) => hasMediaValue(variant.animation_url))?.animation_url
  const orderedVariantMedia = orderedVariants.flatMap((variant) =>
    [...(variant.variant_media || [])]
      .filter((media) => hasMediaValue(media.url))
      .sort(byPreferredOrder)
  )
  const mediaImage = orderedVariantMedia.find((media) => media.type === 'image')?.url
  const mediaAnimation = orderedVariantMedia.find((media) => media.type === 'video')?.url

  return {
    imageUrl: orderedProductImages[0]?.image_url?.trim() || variantImage?.trim() || mediaImage?.trim() || null,
    animationUrl: variantAnimation?.trim() || mediaAnimation?.trim() || null,
  }
}

// ── Functions ────────────────────────────────────────────────────

export async function listProducts(params: ListProductsParams = {}) {
  const { search, category, brandId, sort = 'newest', page = 1, limit = 12, channel = 'store', outdoorOnly = false } = params
  const supabase = createAdminClient()
  const offset = (page - 1) * limit

  // Fetch hidden groups (hide_ecommerce is now on product_groups, not brands)
  const { data: hiddenGroups } = await supabase
    .from('product_groups')
    .select('id')
    .eq('hide_ecommerce', true)

  const hiddenGroupIds = hiddenGroups?.map(g => g.id) || []

  const runQuery = (excludeOutdoorOnly: boolean, hideRemoved = false) => {
  // Build query for products with their variants
  let query = supabase
    .from('products')
    .select(`
      id,
      product_name,
      product_code,
      product_description,
      short_description,
      is_active,
      category_id,
      brand_id,
      created_at,
      product_categories (id, category_name),
      brands (id, brand_name),
      product_images (image_url, is_active, is_primary, sort_order),
      product_variants (
        id,
        variant_name,
        image_url,
        animation_url,
        suggested_retail_price,
        is_active,
        is_default,
        sort_order,
        attributes,
        variant_media (type, url, is_default, sort_order)
      )
    `, { count: 'exact' })
    .eq('is_active', true)

  if (outdoorOnly) query = query.eq('outdoor_only', true)
  else if (excludeOutdoorOnly) query = query.eq('outdoor_only', false)
  if (hideRemoved) query = query.eq('outdoor_hidden', false)

  // Hidden groups stay out of the catalogue. Desk products have no group_id,
  // and NOT IN drops those rows, so the outdoor-only lookup skips this filter.
  if (hiddenGroupIds.length > 0 && !outdoorOnly) {
    query = query.not('group_id', 'in', `(${hiddenGroupIds.map(id => `"${id}"`).join(',')})`)
  }

  // Apply search filter
  if (search) {
    query = query.or(`product_name.ilike.%${search}%,product_code.ilike.%${search}%,product_description.ilike.%${search}%`)
  }

  // Apply category filter
  if (category) {
    query = query.eq('category_id', category)
  }

  if (brandId) {
    query = query.eq('brand_id', brandId)
  }

  // Apply sorting
  switch (sort) {
    case 'name_asc':
      query = query.order('product_name', { ascending: true })
      break
    case 'newest':
      query = query.order('created_at', { ascending: false })
      break
    default:
      query = query.order('created_at', { ascending: false })
  }

  // Pagination
  query = query.range(offset, offset + limit - 1)
  return query
  }

  let { data, error, count } = await runQuery(channel !== 'outdoor', channel === 'outdoor')
  if (error && channel !== 'outdoor' && /outdoor_only/i.test(error.message || '')) {
    const retry = await runQuery(false)
    data = retry.data
    error = retry.error
    count = retry.count
  }
  if (error && channel === 'outdoor' && /outdoor_hidden|outdoor_only/i.test(error.message || '')) {
    const retry = await runQuery(false, false)
    data = retry.data
    error = retry.error
    count = retry.count
  }
  if (error && outdoorOnly) {
    return { products: [], total: 0, page, limit }
  }

  if (error) {
    console.error('Error fetching products:', formatStorefrontError(error))
    return { products: [], total: 0, page, limit }
  }

  // Transform data
  const products: StorefrontProduct[] = (data || []).map((p: any) => {
    const activeVariants = (p.product_variants || []).filter((v: any) => {
      if (v.is_active === false) return false
      const attrs = v.attributes || {}
      if (channel !== 'outdoor' && attrs.outdoor_only_variant) return false
      if (channel === 'outdoor' && attrs.outdoor_hidden) return false
      return true
    })
    const prices = activeVariants
      .map((v: any) => v.suggested_retail_price)
      .filter((price: any) => price != null && price > 0)
    const defaultVariant =
      activeVariants.find((v: any) => v.is_default) || activeVariants[0] || null
    const outdoorPrice = Number(defaultVariant?.attributes?.outdoor_price)
    const editedPrice = channel === 'outdoor' && Number.isFinite(outdoorPrice) && outdoorPrice > 0
      ? outdoorPrice
      : Number(defaultVariant?.suggested_retail_price)
    const startingPrice = channel === 'outdoor' && Number.isFinite(editedPrice) && editedPrice > 0
      ? editedPrice
      : prices.length > 0 ? Math.min(...prices) : null

    const selectedMedia = selectStorefrontProductMedia(p.product_images, activeVariants)
    const firstImage = toStorefrontMediaUrl(selectedMedia.imageUrl)
    const firstAnimation = toStorefrontMediaUrl(selectedMedia.animationUrl)

    // Determine media type
    let mediaType: 'image' | 'video' | 'animation' = 'image'
    if (firstAnimation) {
      const animUrl = firstAnimation.toLowerCase()
      if (animUrl.match(/\.(mp4|webm|mov)($|\?)/)) mediaType = 'video'
      else if (animUrl.match(/\.(json|lottie)($|\?)/)) mediaType = 'animation'
    }

    const colorSwatches = outdoorSwatchesFromVariants(
      activeVariants.map((v: any) => ({
        variant_name: v.variant_name,
        image_url: toStorefrontMediaUrl(v.image_url),
        attributes: v.attributes,
      })),
      p.product_name,
    )

    return {
      id: p.id,
      product_name: p.product_name,
      product_code: p.product_code,
      product_description: p.product_description,
      short_description: p.short_description,
      is_active: p.is_active,
      category_id: p.category_id,
      brand_id: p.brand_id,
      category_name: (p.product_categories as any)?.category_name || null,
      brand_name: (p.brands as any)?.brand_name || null,
      image_url: firstImage,
      animation_url: firstAnimation,
      media_type: mediaType,
      starting_price: startingPrice,
      variant_count: activeVariants.length,
      tags: [
        (p.brands as any)?.brand_name,
        (p.product_categories as any)?.category_name,
      ].filter(Boolean),
      colorSwatches,
      specLabel: outdoorSpecLabel(p.product_name, defaultVariant?.variant_name, defaultVariant?.attributes),
      outdoorNav: outdoorNavKey(String(defaultVariant?.attributes?.outdoor_nav || ''), p.product_name),
    }
  })

  // Sort by price if requested (post-fetch since price is computed)
  if (sort === 'price_asc') {
    products.sort((a, b) => (a.starting_price ?? Infinity) - (b.starting_price ?? Infinity))
  } else if (sort === 'price_desc') {
    products.sort((a, b) => (b.starting_price ?? 0) - (a.starting_price ?? 0))
  }

  return {
    products,
    total: count || 0,
    page,
    limit,
  }
}

export async function getProductDetail(productId: string): Promise<StorefrontProductDetail | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('products')
    .select(`
      id,
      product_name,
      product_code,
      product_description,
      short_description,
      is_active,
      product_categories (category_name),
      brands (brand_name),
      product_groups (hide_ecommerce),
      product_variants (
        id,
        variant_name,
        variant_code,
        image_url,
        animation_url,
        suggested_retail_price,
        base_cost,
        is_active,
        is_default,
        attributes,
        barcode,
        sort_order,
        variant_media (id, type, url, thumbnail_url, sort_order, is_default)
      )
    `)
    .eq('id', productId)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    console.error('Error fetching product detail:', formatStorefrontError(error))
    return null
  }

  const p = data as any

  // If the group is hidden from e-commerce, don't return the product
  if (p.product_groups?.hide_ecommerce) {
    return null
  }

  return {
    id: p.id,
    product_name: p.product_name,
    product_code: p.product_code,
    product_description: p.product_description,
    short_description: p.short_description,
    is_active: p.is_active,
    category_name: p.product_categories?.category_name || null,
    brand_name: p.brands?.brand_name || null,
    variants: (p.product_variants || [])
      .filter((v: any) => v.is_active !== false)
      .sort((a: any, b: any) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
      .map((v: any) => {
        // Build media list from variant_media table (or fall back to legacy fields)
        let media: StorefrontMediaItem[] = []
        if (v.variant_media && v.variant_media.length > 0) {
          media = v.variant_media
            .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map((m: any) => ({
              id: m.id,
              type: m.type,
              url: toStorefrontMediaUrl(m.url) || m.url,
              thumbnail_url: m.thumbnail_url ? (toStorefrontMediaUrl(m.thumbnail_url) || m.thumbnail_url) : null,
              sort_order: m.sort_order ?? 0,
              is_default: m.is_default ?? false,
            }))
        } else {
          // Legacy fallback
          if (v.image_url) {
            media.push({ id: `legacy-img-${v.id}`, type: 'image', url: toStorefrontMediaUrl(v.image_url)!, thumbnail_url: null, sort_order: 0, is_default: true })
          }
          if (v.animation_url) {
            media.push({ id: `legacy-vid-${v.id}`, type: 'video', url: toStorefrontMediaUrl(v.animation_url)!, thumbnail_url: null, sort_order: media.length, is_default: media.length === 0 })
          }
        }

        return {
          id: v.id,
          variant_name: v.variant_name,
          variant_code: v.variant_code,
          image_url: toStorefrontMediaUrl(v.image_url),
          animation_url: toStorefrontMediaUrl(v.animation_url),
          suggested_retail_price: v.suggested_retail_price,
          base_cost: v.base_cost,
          is_active: v.is_active,
          is_default: v.is_default,
          attributes: v.attributes,
          barcode: v.barcode,
          sort_order: v.sort_order,
          media,
        }
      }),
  }
}

export async function listCategories(): Promise<StorefrontCategory[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('product_categories')
    .select('id, category_name, image_url')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('category_name', { ascending: true })

  if (error) {
    console.error('Error fetching categories:', formatStorefrontError(error))
    return []
  }

  const categories: StorefrontCategory[] = (data || []).map((c: any) => ({
    id: c.id,
    name: c.category_name,
    image_url: toStorefrontMediaUrl(c.image_url),
    product_count: 0,
  }))

  return categories
}
