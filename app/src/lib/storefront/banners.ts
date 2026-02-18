import { createAdminClient } from '@/lib/supabase/admin'

export interface StoreBanner {
  id: string
  title: string
  subtitle: string
  badge_text: string
  image_url: string
  link_url: string
  link_text: string
  sort_order: number
  layout_slot: 'carousel' | 'split_main' | 'split_side_top' | 'split_side_bottom'
}

export interface HeroConfig {
  layout_type: 'carousel' | 'split'
  auto_rotate_interval: number
  max_slides: number
}

/**
 * Fetch active store hero banners (server-side).
 * Respects is_active, starts_at, and ends_at scheduling.
 */
export async function listActiveStoreBanners(): Promise<StoreBanner[]> {
  try {
    const supabase = createAdminClient()
    const now = new Date().toISOString()

    const { data, error } = await supabase
      .from('store_hero_banners' as any)
      .select('id, title, subtitle, badge_text, image_url, link_url, link_text, sort_order, layout_slot')
      .eq('is_active', true)
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .order('sort_order', { ascending: true })
      .limit(10)

    if (error) {
      console.error('[listActiveStoreBanners] Error:', error.message)
      return []
    }

    return ((data as any[]) ?? []).map((b) => ({
      ...b,
      layout_slot: b.layout_slot || 'carousel',
    })) as StoreBanner[]
  } catch (err) {
    console.error('[listActiveStoreBanners] Unexpected error:', err)
    return []
  }
}

/**
 * Fetch the hero config for the store (server-side).
 */
export async function getHeroConfig(): Promise<HeroConfig> {
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('store_hero_config' as any)
      .select('layout_type, auto_rotate_interval, max_slides')
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      return { layout_type: 'carousel', auto_rotate_interval: 6000, max_slides: 5 }
    }

    return {
      layout_type: (data as any).layout_type || 'carousel',
      auto_rotate_interval: (data as any).auto_rotate_interval || 6000,
      max_slides: (data as any).max_slides || 5,
    }
  } catch {
    return { layout_type: 'carousel', auto_rotate_interval: 6000, max_slides: 5 }
  }
}
