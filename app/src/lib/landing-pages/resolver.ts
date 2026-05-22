import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  DEFAULT_LANDING_PAGE_DISPLAY_SETTINGS,
  DEFAULT_LANDING_PAGE_HERO,
  DEFAULT_LANDING_PAGE_TRACKING,
  type LandingPageDisplaySettings,
  type LandingPageHeroConfig,
  type LandingPageResolveResult,
  type LandingPageResolvedPage,
  type LandingPageResolvedProduct,
  type LandingPageTrackingDefaults,
} from '@/lib/landing-pages/types'

function toStorefrontMediaUrl(rawPath: string | null): string | null {
  if (!rawPath) return null
  if (rawPath.startsWith('http://') || rawPath.startsWith('https://')) return rawPath

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return rawPath

  const cleanPath = rawPath.replace(/^\/+/, '')
  const knownBuckets = ['product-variants', 'avatars']
  for (const bucket of knownBuckets) {
    if (cleanPath.startsWith(`${bucket}/`)) {
      const objectPath = cleanPath.slice(bucket.length + 1)
      return `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
    }
  }

  const defaultBucket = process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET || 'avatars'
  return `${supabaseUrl}/storage/v1/object/public/${defaultBucket}/${cleanPath}`
}

function mergeHero(value: unknown): LandingPageHeroConfig {
  return { ...DEFAULT_LANDING_PAGE_HERO, ...((value && typeof value === 'object') ? value : {}) }
}

function mergeDisplaySettings(value: unknown): LandingPageDisplaySettings {
  return { ...DEFAULT_LANDING_PAGE_DISPLAY_SETTINGS, ...((value && typeof value === 'object') ? value : {}) }
}

function mergeTracking(value: unknown): LandingPageTrackingDefaults {
  return { ...DEFAULT_LANDING_PAGE_TRACKING, ...((value && typeof value === 'object') ? value : {}) }
}

function getRelationObject<T extends Record<string, any>>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function isPublishedInWindow(page: any, now = new Date()) {
  if (page.status !== 'published') return false
  if (page.publish_start_at && new Date(page.publish_start_at) > now) return false
  if (page.publish_end_at && new Date(page.publish_end_at) < now) return false
  return true
}

function getWindowStatus(page: any, now = new Date()): LandingPageResolveResult['status'] | null {
  if (page.status !== 'published') return 'not_found'
  if (page.publish_start_at && new Date(page.publish_start_at) > now) return 'scheduled'
  if (page.publish_end_at && new Date(page.publish_end_at) < now) return 'expired'
  return null
}

function serializePage(page: any): LandingPageResolvedPage {
  const category = getRelationObject(page.product_categories)
  return {
    id: page.id,
    public_title: page.public_title,
    slug: page.slug,
    description: page.description,
    hero: mergeHero(page.hero),
    display_settings: mergeDisplaySettings(page.display_settings),
    tracking_defaults: mergeTracking(page.tracking_defaults),
    source_mode: page.source_mode,
    category_name: category?.category_name ?? null,
    published_at: page.published_at,
  }
}

async function resolveProductIdsForPage(adminClient: any, page: any): Promise<string[]> {
  if (page.source_mode === 'manual') {
    const { data, error } = await adminClient
      .from('landing_page_products')
      .select('product_id, sort_order')
      .eq('landing_page_id', page.id)
      .order('sort_order', { ascending: true })

    if (error) throw error
    return Array.from(new Set((data || []).map((row: any) => row.product_id).filter(Boolean)))
  }

  if (page.source_mode === 'category' && page.category_id) {
    const { data, error } = await adminClient
      .from('products')
      .select('id')
      .eq('is_active', true)
      .eq('category_id', page.category_id)
      .order('product_name', { ascending: true })
      .limit(Math.max(page.max_products || 12, 1) * 3)

    if (error) throw error
    return (data || []).map((row: any) => row.id)
  }

  return []
}

async function loadInventoryByVariant(adminClient: any, variantIds: string[]) {
  if (variantIds.length === 0) return new Map<string, number>()

  const { data } = await adminClient
    .from('product_inventory')
    .select('variant_id, quantity_available, quantity_on_hand, is_active')
    .in('variant_id', variantIds)
    .eq('is_active', true)

  const inventory = new Map<string, number>()
  for (const row of data || []) {
    const quantity = Number(row.quantity_available ?? row.quantity_on_hand ?? 0)
    inventory.set(row.variant_id, (inventory.get(row.variant_id) || 0) + quantity)
  }
  return inventory
}

async function loadResolvedProducts(adminClient: any, page: any, productIds: string[]): Promise<LandingPageResolvedProduct[]> {
  if (productIds.length === 0) return []

  const displaySettings = mergeDisplaySettings(page.display_settings)
  const maxProducts = Math.min(Math.max(Number(page.max_products || 12), 1), 60)
  const order = new Map(productIds.map((id, index) => [id, index]))

  const { data, error } = await adminClient
    .from('products')
    .select(`
      id,
      product_name,
      product_code,
      product_description,
      short_description,
      is_active,
      is_discontinued,
      category_id,
      brand_id,
      group_id,
      product_categories (id, category_name),
      brands (id, brand_name),
      product_groups (id, group_name, hide_ecommerce, hide_product, hide_price),
      product_variants (id, variant_name, variant_code, image_url, animation_url, suggested_retail_price, is_active, is_default, sort_order)
    `)
    .in('id', productIds)
    .eq('is_active', true)

  if (error) throw error

  const allVariantIds = (data || [])
    .flatMap((product: any) => product.product_variants || [])
    .map((variant: any) => variant.id)
    .filter(Boolean)

  const inventory = displaySettings.hide_out_of_stock
    ? await loadInventoryByVariant(adminClient, allVariantIds)
    : new Map<string, number>()

  const products = (data || [])
    .sort((left: any, right: any) => (order.get(left.id) ?? 9999) - (order.get(right.id) ?? 9999))
    .map((product: any): LandingPageResolvedProduct | null => {
      const group = getRelationObject(product.product_groups)
      if (group?.hide_ecommerce === true || group?.hide_product === true) return null
      if (product.is_discontinued === true) return null

      const activeVariants = (product.product_variants || [])
        .filter((variant: any) => variant.is_active !== false)
        .sort((left: any, right: any) => {
          if (left.is_default && !right.is_default) return -1
          if (!left.is_default && right.is_default) return 1
          return (left.sort_order ?? 999) - (right.sort_order ?? 999)
        })

      const availableVariants = displaySettings.hide_out_of_stock
        ? activeVariants.filter((variant: any) => (inventory.get(variant.id) || 0) > 0)
        : activeVariants

      if (availableVariants.length === 0) return null

      const priceHidden = displaySettings.show_price === false || group?.hide_price === true
      const pricedVariants = availableVariants.filter((variant: any) => Number(variant.suggested_retail_price || 0) > 0)
      const primaryVariant = pricedVariants[0] || availableVariants[0]
      const prices = pricedVariants.map((variant: any) => Number(variant.suggested_retail_price))
      const startingPrice = !priceHidden && prices.length > 0 ? Math.min(...prices) : null
      const canPurchase = !priceHidden && Number(primaryVariant?.suggested_retail_price || 0) > 0
      const variantImage = toStorefrontMediaUrl(primaryVariant?.image_url || null)
      const variantAnimation = toStorefrontMediaUrl(primaryVariant?.animation_url || null)
      const category = getRelationObject(product.product_categories)
      const brand = getRelationObject(product.brands)

      return {
        id: product.id,
        product_name: product.product_name,
        product_code: product.product_code,
        short_description: product.short_description,
        product_description: product.product_description,
        category_name: displaySettings.show_category ? category?.category_name ?? null : null,
        brand_name: displaySettings.show_brand ? brand?.brand_name ?? null : null,
        image_url: variantImage,
        animation_url: variantAnimation,
        starting_price: startingPrice,
        active_variant_count: availableVariants.length,
        primary_variant: primaryVariant
          ? {
              id: primaryVariant.id,
              variant_name: primaryVariant.variant_name,
              price: canPurchase ? Number(primaryVariant.suggested_retail_price) : null,
              image_url: variantImage,
            }
          : null,
        can_purchase: canPurchase,
      }
    })
    .filter((product: LandingPageResolvedProduct | null): product is LandingPageResolvedProduct => Boolean(product))

  return products.slice(0, maxProducts)
}

async function resolveLandingPage(query: { slug?: string; id?: string; organizationId?: string; preview?: boolean }): Promise<LandingPageResolveResult> {
  const adminClient = createAdminClient() as any
  let pageQuery = adminClient
    .from('landing_pages')
    .select('*, product_categories (id, category_name)')

  if (query.id) pageQuery = pageQuery.eq('id', query.id)
  if (query.slug) pageQuery = pageQuery.eq('slug', query.slug)
  if (query.organizationId) pageQuery = pageQuery.eq('organization_id', query.organizationId)

  const { data: page, error } = await pageQuery.maybeSingle()

  if (error || !page) {
    return { status: 'not_found', page: null, products: [], reason: 'Landing page was not found.' }
  }

  if (!query.preview) {
    const windowStatus = getWindowStatus(page)
    if (windowStatus) {
      const reason = windowStatus === 'expired'
        ? 'This campaign has ended.'
        : windowStatus === 'scheduled'
          ? 'This campaign is not live yet.'
          : 'Landing page is not public.'
      return { status: windowStatus, page: windowStatus === 'not_found' ? null : serializePage(page), products: [], reason }
    }
  } else if (!isPublishedInWindow(page) && page.status === 'archived') {
    return { status: 'not_found', page: null, products: [], reason: 'Archived landing pages cannot be previewed.' }
  }

  const productIds = await resolveProductIdsForPage(adminClient, page)
  const products = await loadResolvedProducts(adminClient, page, productIds)

  if (products.length === 0) {
    return {
      status: 'unavailable',
      page: serializePage(page),
      products: [],
      reason: 'This campaign is currently unavailable.',
    }
  }

  return {
    status: 'ok',
    page: serializePage(page),
    products,
    reason: null,
  }
}

export function resolvePublicLandingPageBySlug(slug: string) {
  return resolveLandingPage({ slug, preview: false })
}

export function resolveLandingPagePreview(id: string, organizationId: string) {
  return resolveLandingPage({ id, organizationId, preview: true })
}

export async function countResolvableLandingPageProducts(pageId: string, organizationId: string) {
  const result = await resolveLandingPagePreview(pageId, organizationId)
  return result.products.length
}