export type LandingPageStatus = 'draft' | 'published' | 'archived'
export type LandingPageSourceMode = 'manual' | 'category'
export type LandingPageCtaMode = 'view_product' | 'add_to_cart' | 'buy_now' | 'whatsapp'

export const LANDING_PAGE_EVENT_TYPES = [
  'page_view',
  'product_impression',
  'product_click',
  'product_view',
  'add_to_cart',
  'buy_now_click',
  'checkout_start',
  'order_created',
  'purchase',
] as const

export type LandingPageEventType = (typeof LANDING_PAGE_EVENT_TYPES)[number]

export interface LandingPageHeroConfig {
  badge_text: string
  headline: string
  subtitle: string
  hero_image_url: string
  primary_cta_label: string
  secondary_cta_label: string
  secondary_cta_url: string
}

export interface LandingPageDisplaySettings {
  show_price: boolean
  show_brand: boolean
  show_category: boolean
  hide_out_of_stock: boolean
  cta_mode: LandingPageCtaMode
  enable_add_to_cart: boolean
  enable_buy_now: boolean
  enable_whatsapp: boolean
  whatsapp_phone: string
}

export interface LandingPageTrackingDefaults {
  source_code: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_content: string
  utm_term: string
}

export interface LandingPageMetrics {
  views: number
  sessions: number
  product_clicks: number
  add_to_cart: number
  checkout_starts: number
  orders: number
  revenue: number
  conversion_rate: number
}

export interface LandingPageAdminRecord {
  id: string
  organization_id: string
  internal_name: string
  public_title: string
  slug: string
  description: string | null
  status: LandingPageStatus
  source_mode: LandingPageSourceMode
  category_id: string | null
  category_name: string | null
  max_products: number
  hero: LandingPageHeroConfig
  display_settings: LandingPageDisplaySettings
  tracking_defaults: LandingPageTrackingDefaults
  publish_start_at: string | null
  publish_end_at: string | null
  published_at: string | null
  selected_product_ids: string[]
  selected_products_count: number
  metrics: LandingPageMetrics
  created_at: string | null
  updated_at: string | null
}

export interface LandingPageProductOption {
  id: string
  product_name: string
  product_code: string
  short_description: string | null
  category_id: string | null
  category_name: string | null
  brand_name: string | null
  image_url: string | null
  starting_price: number | null
  variant_count: number
  active_variant_count: number
  can_purchase: boolean
}

export interface LandingPageCategoryOption {
  id: string
  name: string
}

export interface LandingPagePayload {
  internal_name: string
  public_title: string
  slug: string
  description: string
  status: LandingPageStatus
  source_mode: LandingPageSourceMode
  category_id: string | null
  max_products: number
  hero: LandingPageHeroConfig
  display_settings: LandingPageDisplaySettings
  tracking_defaults: LandingPageTrackingDefaults
  publish_start_at: string | null
  publish_end_at: string | null
  selected_product_ids: string[]
}

export interface LandingPageAttribution {
  landingPageId: string
  landingPageSlug: string
  landingPageSessionId: string
  landingPageTitle?: string
  sourceCode: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmContent: string
  utmTerm: string
  fbclid: string
  referrerDomain: string
}

export interface LandingPageResolvedVariant {
  id: string
  variant_name: string
  price: number | null
  image_url: string | null
}

export interface LandingPageResolvedProduct {
  id: string
  product_name: string
  product_code: string
  short_description: string | null
  product_description: string | null
  category_name: string | null
  brand_name: string | null
  image_url: string | null
  animation_url: string | null
  starting_price: number | null
  active_variant_count: number
  primary_variant: LandingPageResolvedVariant | null
  can_purchase: boolean
}

export interface LandingPageResolvedPage {
  id: string
  public_title: string
  slug: string
  description: string | null
  hero: LandingPageHeroConfig
  display_settings: LandingPageDisplaySettings
  tracking_defaults: LandingPageTrackingDefaults
  source_mode: LandingPageSourceMode
  category_name: string | null
  published_at: string | null
}

export type LandingPageResolveStatus = 'ok' | 'not_found' | 'unavailable' | 'expired' | 'scheduled'

export interface LandingPageResolveResult {
  status: LandingPageResolveStatus
  page: LandingPageResolvedPage | null
  products: LandingPageResolvedProduct[]
  reason: string | null
}

export const DEFAULT_LANDING_PAGE_HERO: LandingPageHeroConfig = {
  badge_text: 'Exclusive Deal',
  headline: '',
  subtitle: '',
  hero_image_url: '',
  primary_cta_label: 'Shop Now',
  secondary_cta_label: 'View Deals',
  secondary_cta_url: '',
}

export const DEFAULT_LANDING_PAGE_DISPLAY_SETTINGS: LandingPageDisplaySettings = {
  show_price: true,
  show_brand: true,
  show_category: true,
  hide_out_of_stock: false,
  cta_mode: 'add_to_cart',
  enable_add_to_cart: true,
  enable_buy_now: true,
  enable_whatsapp: false,
  whatsapp_phone: '',
}

export const DEFAULT_LANDING_PAGE_TRACKING: LandingPageTrackingDefaults = {
  source_code: '',
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
  utm_content: '',
  utm_term: '',
}

export const EMPTY_LANDING_PAGE_METRICS: LandingPageMetrics = {
  views: 0,
  sessions: 0,
  product_clicks: 0,
  add_to_cart: 0,
  checkout_starts: 0,
  orders: 0,
  revenue: 0,
  conversion_rate: 0,
}